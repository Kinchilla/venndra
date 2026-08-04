import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";
import { createGoogleEvent, updateGoogleEventTime } from "../../../../../lib/calendar/google";
import { createMicrosoftEvent, updateMicrosoftEventTime } from "../../../../../lib/calendar/microsoft";
import { createAppleEvent, updateAppleEventTime } from "../../../../../lib/calendar/apple";

const confirmSchema = z.object({ start: z.string().datetime() });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = confirmSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    include: { participants: { include: { user: { select: { name: true } } } } },
  });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const userId = (session.user as any).id;
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
  const attendeeEmails = event.participants
    .map((p) => p.email)
    .filter((email) => email !== session.user!.email);

  let externalEventId: string | undefined = event.externalEventId ?? undefined;
  let externalEventHref: string | undefined = event.externalEventHref ?? undefined;
  let externalEventEtag: string | null = event.externalEventEtag ?? null;

  if (connectedCalendar.provider === "GOOGLE" && connectedCalendar.nextAuthAccountId) {
    if (isReschedule) {
      await updateGoogleEventTime(connectedCalendar.nextAuthAccountId, writeSource.externalId, externalEventId!, { start, end });
    } else {
      externalEventId = await createGoogleEvent(connectedCalendar.nextAuthAccountId, writeSource.externalId, {
        title: event.title,
        description: event.description ?? undefined,
        location: event.location ?? undefined,
        start,
        end,
        attendeeEmails,
      });
    }
  } else if (connectedCalendar.provider === "MICROSOFT" && connectedCalendar.nextAuthAccountId) {
    if (isReschedule) {
      await updateMicrosoftEventTime(connectedCalendar.nextAuthAccountId, externalEventId!, { start, end });
    } else {
      externalEventId = await createMicrosoftEvent(connectedCalendar.nextAuthAccountId, writeSource.externalId, {
        title: event.title,
        description: event.description ?? undefined,
        location: event.location ?? undefined,
        start,
        end,
        attendeeEmails,
      });
    }
  } else if (connectedCalendar.provider === "APPLE_CALDAV") {
    // Apple has no separate "update time only" concept the way
    // Google/Microsoft do -- a reschedule is a full re-PUT of the VEVENT.
    // In practice this isReschedule branch won't be exercised for Apple in
    // this app's normal flow: reopen/route.ts unconditionally deletes the
    // upstream Apple event and nulls externalEventId/externalEventHref
    // before handing back here, so a rescheduled Apple event always takes
    // the create path below with a fresh UID. Kept for structural parity
    // with Google/Microsoft and in case isReschedule is ever reached
    // another way.
    if (isReschedule) {
      const result = await updateAppleEventTime(connectedCalendar.id, {
        href: event.externalEventHref!,
        etag: event.externalEventEtag,
        start,
        end,
      });
      externalEventEtag = result.externalEventEtag;
    } else {
      // Includes the organizer themselves, unlike Google/Microsoft's
      // attendeeEmails above -- this is just a plain-text reference list
      // in the DESCRIPTION, not a real attendee list, so there's no reason
      // to exclude the organizer's own name from it.
      const participantsForDescription = event.participants.map((p) => ({
        email: p.email,
        name: p.user?.name ?? null,
      }));
      const result = await createAppleEvent(connectedCalendar.id, writeSource.externalId, {
        title: event.title,
        description: event.description ?? undefined,
        location: event.location ?? undefined,
        start,
        end,
        participants: participantsForDescription,
      });
      externalEventId = result.externalEventId;
      externalEventHref = result.externalEventHref;
      externalEventEtag = result.externalEventEtag;
    }
  } else {
    // Shouldn't happen -- every provider that can be a write target is
    // handled above; guard against a future provider being added to
    // CalendarProvider without a matching branch here.
    return NextResponse.json({ error: "That calendar type doesn't support creating events yet" }, { status: 400 });
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
