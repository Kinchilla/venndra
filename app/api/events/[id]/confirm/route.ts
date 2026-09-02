import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../../../lib/prisma";
import { updateGoogleEventTime } from "../../../../../lib/calendar/google";
import { updateMicrosoftEventTime } from "../../../../../lib/calendar/microsoft";
import { updateAppleEventTime } from "../../../../../lib/calendar/apple";
import { createUpstreamEvent } from "../../../../../lib/upstreamEvents";
import { jsonBody } from "../../../../../lib/requestBody";
import { currentUser, unauthorized } from "../../../../../lib/session";

const confirmSchema = z.object({ start: z.string().datetime() });

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const sessionUser = await currentUser();
  if (!sessionUser) return unauthorized();

  const parsed = confirmSchema.safeParse(await jsonBody(req));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    include: { participants: { include: { user: { select: { name: true } } } } },
  });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const userId = sessionUser.id;
  if (event.creatorId !== userId) {
    return NextResponse.json({ error: "Only the event creator can confirm a slot" }, { status: 403 });
  }
  if (event.status !== "SEARCHING") {
    return NextResponse.json({ error: "This event has already been confirmed or cancelled" }, { status: 409 });
  }

  const start = new Date(parsed.data.start);
  const end = new Date(start.getTime() + event.durationMin * 60_000);

  // A rescheduled event (reopened after a prior confirmation) already knows
  // which calendar it lives on -- keep targeting that same one even if the
  // organizer has since changed their write-target setting, so the patch
  // doesn't silently miss. A first-time confirm looks up whatever's
  // currently marked as the write target.
  const isReschedule = !!event.writeCalendarSourceId && !!event.externalEventId;

  const writeSource = await prisma.calendarSource.findFirst({
    where: isReschedule
      ? { id: event.writeCalendarSourceId! }
      : { connectedCalendar: { userId, isEnabled: true }, isWriteTarget: true },
    include: { connectedCalendar: true },
  });

  if (!writeSource) {
    return NextResponse.json(
      { error: "Pick a calendar to add new events to, from your dashboard, before confirming a time" },
      { status: 400 }
    );
  }

  const { connectedCalendar } = writeSource;

  let externalEventId: string | undefined = event.externalEventId ?? undefined;
  let externalEventHref: string | undefined = event.externalEventHref ?? undefined;
  let externalEventEtag: string | null = event.externalEventEtag ?? null;

  // Reschedule and first-time confirm are the OUTER branch now, with the
  // provider dispatch inside each. It used to be the other way round, which
  // put a move and a create side by side in every provider's arm and left the
  // create looking like three unrelated blocks rather than the one thing
  // reassign also needed. Same six combinations, tested in the same order.
  if (isReschedule) {
    if (connectedCalendar.provider === "GOOGLE" && connectedCalendar.nextAuthAccountId) {
      await updateGoogleEventTime(connectedCalendar.nextAuthAccountId, writeSource.externalId, externalEventId!, { start, end });
    } else if (connectedCalendar.provider === "MICROSOFT" && connectedCalendar.nextAuthAccountId) {
      await updateMicrosoftEventTime(connectedCalendar.nextAuthAccountId, externalEventId!, { start, end });
    } else if (connectedCalendar.provider === "APPLE_CALDAV") {
      // Apple has no separate "update time only" concept the way
      // Google/Microsoft do -- a reschedule is a full re-PUT of the VEVENT.
      // In practice this branch won't be exercised for Apple in this app's
      // normal flow: reopen/route.ts deletes the upstream Apple event and
      // nulls externalEventId/externalEventHref before handing back here, so
      // a rescheduled Apple event always takes the create path below with a
      // fresh UID. Kept for structural parity with Google/Microsoft and in
      // case isReschedule is ever reached another way.
      const result = await updateAppleEventTime(connectedCalendar.id, {
        href: event.externalEventHref!,
        etag: event.externalEventEtag,
        start,
        end,
      });
      externalEventEtag = result.externalEventEtag;
    } else {
      return NextResponse.json({ error: "That calendar type doesn't support creating events yet" }, { status: 400 });
    }
  } else {
    // lib/upstreamEvents, shared with reassign, which creates the same event
    // on a new organizer's calendar. Deliberately NOT wrapped in a try here:
    // this route has never caught a provider failure, and swallowing one
    // would record an event as CONFIRMED that never reached anybody's
    // calendar. reassign catches it because by that point it has something to
    // report as undone -- which is exactly why the handling stays out here at
    // the call sites instead of being averaged into the helper.
    const created = await createUpstreamEvent(writeSource, {
      title: event.title,
      description: event.description,
      location: event.location,
      start,
      end,
      // The organizer owns the calendar, so they are not invited to their own
      // event. Apple's list is a plain-text reference in the DESCRIPTION
      // rather than a real attendee list, and does include them.
      attendeeEmails: event.participants.map((p) => p.email).filter((email) => email !== sessionUser.email),
      participants: event.participants.map((p) => ({ email: p.email, name: p.user?.name ?? null })),
    });
    if (!created) {
      // Shouldn't happen -- every provider that can be a write target is
      // handled; guards against a future provider being added to
      // CalendarProvider without a matching branch.
      return NextResponse.json({ error: "That calendar type doesn't support creating events yet" }, { status: 400 });
    }
    externalEventId = created.externalEventId;
    externalEventHref = created.externalEventHref;
    externalEventEtag = created.externalEventEtag;
  }

  const updated = await prisma.event.update({
    where: { id: event.id },
    data: {
      status: "CONFIRMED",
      confirmedStart: start,
      confirmedEnd: end,
      externalEventId,
      externalEventHref,
      externalEventEtag,
      writeError: null,
      writeCalendarSourceId: writeSource.id,
    },
  });

  return NextResponse.json({ event: updated });
}
