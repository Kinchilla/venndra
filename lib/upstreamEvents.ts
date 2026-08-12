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
 * Both are best-effort by design, and neither throws. If the upstream event
 * is already gone -- deleted by hand in Google Calendar, or belonging to a
 * calendar whose credentials have since been revoked -- that is not a reason
 * to block someone from cancelling, leaving, or deleting their account in
 * Venndra. The failure is logged, and in the one case where no provider will
 * tell anybody otherwise (Apple), recorded on the event for the organizer to
 * see on their next page load.
 *
 * NOT used by the reassign route, which has its own copy of the delete half.
 * That one is deliberately sequenced around a create-on-the-new-calendar
 * step that has to succeed first, and folding it in here would mean bending
 * this helper around an ordering constraint only that route has.
 */

import type { Event } from "@prisma/client";
import { prisma } from "./prisma";
import { deleteGoogleEvent, removeGoogleAttendee } from "./calendar/google";
import { deleteMicrosoftEvent, removeMicrosoftAttendee } from "./calendar/microsoft";
import { buildAppleDescriptionText, deleteAppleEvent, updateAppleEventDescription } from "./calendar/apple";

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
 */
export async function deleteUpstreamEvent(event: UpstreamEvent): Promise<void> {
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
    console.error("Failed to delete upstream calendar event:", err);
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
