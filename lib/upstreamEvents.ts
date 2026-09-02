/**
 * The two things Venndra does to a REAL calendar event when its Venndra
 * record changes: delete it outright, and take one attendee off it.
 *
 * Both were written inline in the route that first needed them (cancel and
 * leave respectively), and both are now needed a second time by account
 * deletion -- which cancels every upcoming event the departing user
 * organizes, and removes them from every event they'd merely joined. Copying
 * either one would have been the worst option available: these are the
 * blocks that reach three different providers, each with its own quirks
 * (Microsoft needs no calendar id, Apple needs an href and an ETag and has
 * no attendee list at all), and a bug fixed in one copy is a bug still live
 * in the other.
 *
 * The reopen route (reschedule) called its own copy of the delete half until
 * #30 -- the same dispatch, the same guards, written out again -- and now
 * calls this one. Callers of deleteUpstreamEvent: cancel, reopen, and account
 * deletion.
 *
 * Both are best-effort by design, and neither throws. If the upstream event
 * is already gone -- deleted by hand in Google Calendar, or belonging to a
 * calendar whose credentials have since been revoked -- that is not a reason
 * to block someone from cancelling, leaving, or deleting their account in
 * Venndra. The failure is logged, and in the one case where no provider will
 * tell anybody otherwise (Apple), recorded on the event for the organizer to
 * see on their next page load.
 *
 * The reassign route kept its own copy of the delete half longer than the
 * others, on the argument that it is "deliberately sequenced around a
 * create-on-the-new-calendar step that has to succeed first". Worked through
 * under #30, and the argument does not hold: sequencing is about WHERE a call
 * happens, and a helper called after the create is as sequenced as a block
 * written after it. reassign now calls deleteUpstreamEvent too, in the same
 * position its own copy occupied.
 *
 * Every caller: cancel, reopen, reassign, and account deletion.
 */

import type { ConnectedCalendar, Event } from "@prisma/client";
import { prisma } from "./prisma";
import { createGoogleEvent, deleteGoogleEvent, removeGoogleAttendee } from "./calendar/google";
import { createMicrosoftEvent, deleteMicrosoftEvent, removeMicrosoftAttendee } from "./calendar/microsoft";
import {
  buildAppleDescriptionText,
  createAppleEvent,
  deleteAppleEvent,
  updateAppleEventDescription,
} from "./calendar/apple";

/** Everything either function below needs off an Event, and nothing more -- so callers can pass a partial select. */
export type UpstreamEvent = Pick<
  Event,
  "id" | "status" | "description" | "writeCalendarSourceId" | "externalEventId" | "externalEventHref" | "externalEventEtag"
>;

/** The calendar an event was actually written to at confirm time, with the account behind it. */
function loadWriteSource(event: UpstreamEvent) {
  if (!event.writeCalendarSourceId) return null;
  return prisma.calendarSource.findUnique({
    where: { id: event.writeCalendarSourceId },
    include: { connectedCalendar: true },
  });
}

/**
 * Deletes the real calendar event, so every attendee gets that provider's
 * own cancellation notice -- rather than leaving a stale entry sitting on
 * everyone's calendar with no explanation of why it isn't happening.
 *
 * A no-op unless the event is CONFIRMED and actually reached a calendar: a
 * still-SEARCHING event has no upstream counterpart to remove.
 *
 * `context` names the flow this delete belongs to, and exists for one specific
 * reason: lib/sentryOptions installs captureConsoleIntegration, so every
 * console.error below becomes a Sentry issue TITLED BY ITS MESSAGE. Callers
 * that had their own wording before this helper absorbed them would otherwise
 * collapse into a single issue, and "a delete failed somewhere" is a much
 * worse thing to be paged about than "the reschedule delete failed". Passed
 * only by the callers that had a distinct message of their own, so the ones
 * that did not keep their existing grouping exactly.
 */
export async function deleteUpstreamEvent(event: UpstreamEvent, context?: string): Promise<void> {
  if (event.status !== "CONFIRMED" || !event.externalEventId || !event.writeCalendarSourceId) return;

  const writeSource = await loadWriteSource(event);
  const calendar = writeSource?.connectedCalendar;

  try {
    if (calendar?.provider === "GOOGLE" && calendar.nextAuthAccountId) {
      await deleteGoogleEvent(calendar.nextAuthAccountId, writeSource!.externalId, event.externalEventId);
    } else if (calendar?.provider === "MICROSOFT" && calendar.nextAuthAccountId) {
      await deleteMicrosoftEvent(calendar.nextAuthAccountId, event.externalEventId);
    } else if (calendar?.provider === "APPLE_CALDAV" && event.externalEventHref) {
      await deleteAppleEvent(calendar.id, { href: event.externalEventHref, etag: event.externalEventEtag });
    }
  } catch (err) {
    // Already deleted by hand, or the credentials are gone -- either way the
    // Venndra-side change should still go through.
    console.error(`Failed to delete upstream calendar event${context ? ` during ${context}` : ""}:`, err);
  }
}

/**
 * Takes one person off the real calendar event, leaving it standing for
 * everybody else.
 *
 * `participantId` is the EventParticipant row being removed. It's needed
 * (rather than just the email) for the Apple branch, which rebuilds the
 * event's description from whoever is left and so has to exclude exactly one
 * row -- and has to do it while that row still exists, which is why this
 * runs BEFORE the delete rather than after.
 */
export async function removeAttendeeFromUpstreamEvent(
  event: UpstreamEvent,
  participant: { id: string; email: string }
): Promise<void> {
  if (event.status !== "CONFIRMED" || !event.writeCalendarSourceId) return;

  const writeSource = await loadWriteSource(event);
  const calendar = writeSource?.connectedCalendar;

  try {
    if (calendar?.provider === "GOOGLE" && calendar.nextAuthAccountId && event.externalEventId) {
      await removeGoogleAttendee(
        calendar.nextAuthAccountId,
        writeSource!.externalId,
        event.externalEventId,
        participant.email
      );
    } else if (calendar?.provider === "MICROSOFT" && calendar.nextAuthAccountId && event.externalEventId) {
      await removeMicrosoftAttendee(calendar.nextAuthAccountId, event.externalEventId, participant.email);
    }
  } catch (err) {
    // If the upstream event or attendee is already gone somehow, don't block
    // the Venndra-side removal over it.
    console.error("Failed to remove attendee from upstream calendar event:", err);
  }

  // Apple has no ATTENDEE list to patch -- instead, re-PUT the event with an
  // updated plain-text DESCRIPTION reflecting who's still attending.
  if (calendar?.provider === "APPLE_CALDAV" && event.externalEventHref) {
    try {
      const remaining = await prisma.eventParticipant.findMany({
        where: { eventId: event.id, id: { not: participant.id } },
        include: { user: { select: { name: true } } },
      });
      const description = buildAppleDescriptionText(
        event.description,
        remaining.map((p) => ({ email: p.email, name: p.user?.name ?? null }))
      );
      const result = await updateAppleEventDescription(calendar.id, {
        href: event.externalEventHref,
        etag: event.externalEventEtag,
        description,
      });
      await prisma.event.update({
        where: { id: event.id },
        data: { externalEventEtag: result.externalEventEtag, writeError: null },
      });
    } catch (err) {
      // Don't block over this -- but unlike the Google/Microsoft case above,
      // there's no provider-side notification if it silently fails, so
      // record it for the organizer to notice on their next page load.
      console.error("Failed to update Apple calendar event description:", err);
      await prisma.event.update({
        where: { id: event.id },
        data: {
          writeError:
            "Couldn't update your iCloud calendar event after someone left the event -- check it manually.",
        },
      });
    }
  }
}

/**
 * The calendar a write actually goes through: a CalendarSource plus the
 * account behind it. A structural subset rather than the Prisma row, for the
 * same reason as UpstreamEvent above -- callers pass whatever their own query
 * returned, and this names the three fields that matter.
 */
export type UpstreamWriteTarget = {
  /** CalendarSource.externalId -- the provider's own calendar id, or for Apple the CalDAV collection URL. */
  externalId: string;
  connectedCalendar: Pick<ConnectedCalendar, "id" | "provider" | "nextAuthAccountId">;
};

/** What to put on the calendar. Nullable fields are the Prisma columns as they come. */
export type UpstreamEventDetails = {
  title: string;
  description: string | null;
  location: string | null;
  start: Date;
  end: Date;
  /**
   * The real invitee list, for Google and Microsoft. Excludes whoever owns the
   * calendar being written to -- they are implicitly on their own event, and
   * inviting yourself reads oddly on both providers.
   */
  attendeeEmails: string[];
  /**
   * Everyone, INCLUDING the calendar's owner, for Apple. CalDAV has no real
   * attendee list, so the names go into a plain-text DESCRIPTION instead, and
   * there is no reason to leave the organizer out of a reference list.
   */
  participants: { email: string; name: string | null }[];
};

/** Apple returns an href and an ETag as well; the other two return an id and nothing else. */
export type CreatedUpstreamEvent = {
  externalEventId: string;
  externalEventHref?: string;
  externalEventEtag: string | null;
};

/**
 * Creates the real calendar event, on whichever provider the write target
 * belongs to.
 *
 * Written out in full by the confirm route, then again by reassign when
 * transferring an event to a new organizer's calendar -- the same three
 * branches, the same argument shape, the same Apple special case, a few files
 * apart (#30). That is exactly what this module exists to stop: three
 * providers with three sets of quirks, where a fix applied to one copy is a
 * bug still live in the other.
 *
 * UNLIKE the two functions above, this one is NOT best-effort and DOES throw.
 * They are cleanup after a decision the user already made, so failing quietly
 * is right. This one IS the decision: if it fails, nothing should be recorded
 * as confirmed or transferred. The two callers then differ in what they do
 * about a failure -- confirm lets it propagate, reassign catches it to say
 * "nothing was changed" -- so the handling deliberately stays at the call
 * sites rather than being averaged into one behaviour here.
 *
 * Returns null, rather than throwing, for a provider that cannot create
 * events. That is not a failure but an unreachable state: every provider that
 * can be a write target is handled here. It is a guard against a future
 * CalendarProvider being added without a matching branch, and both callers
 * answer it with the same 400.
 */
export async function createUpstreamEvent(
  writeSource: UpstreamWriteTarget,
  details: UpstreamEventDetails
): Promise<CreatedUpstreamEvent | null> {
  const calendar = writeSource.connectedCalendar;

  // Both providers below take description/location as optional strings, where
  // the Prisma columns are nullable -- converted once here rather than at each
  // call site.
  const common = {
    title: details.title,
    description: details.description ?? undefined,
    location: details.location ?? undefined,
    start: details.start,
    end: details.end,
  };

  if (calendar.provider === "GOOGLE" && calendar.nextAuthAccountId) {
    const externalEventId = await createGoogleEvent(calendar.nextAuthAccountId, writeSource.externalId, {
      ...common,
      attendeeEmails: details.attendeeEmails,
    });
    return { externalEventId, externalEventEtag: null };
  }

  if (calendar.provider === "MICROSOFT" && calendar.nextAuthAccountId) {
    const externalEventId = await createMicrosoftEvent(calendar.nextAuthAccountId, writeSource.externalId, {
      ...common,
      attendeeEmails: details.attendeeEmails,
    });
    return { externalEventId, externalEventEtag: null };
  }

  if (calendar.provider === "APPLE_CALDAV") {
    return await createAppleEvent(calendar.id, writeSource.externalId, {
      ...common,
      participants: details.participants,
    });
  }

  return null;
}
