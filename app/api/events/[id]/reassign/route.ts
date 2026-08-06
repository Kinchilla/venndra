import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";
import { createGoogleEvent, deleteGoogleEvent } from "../../../../../lib/calendar/google";
import { createMicrosoftEvent, deleteMicrosoftEvent } from "../../../../../lib/calendar/microsoft";
import { createAppleEvent, deleteAppleEvent } from "../../../../../lib/calendar/apple";

const reassignSchema = z.object({ newOrganizerUserId: z.string().min(1) });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = reassignSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { newOrganizerUserId } = parsed.data;

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    include: { participants: { include: { user: { select: { name: true } } } } },
  });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const userId = (session.user as any).id;
  if (event.creatorId !== userId) {
    return NextResponse.json({ error: "Only the event organizer can do this" }, { status: 403 });
  }
  if (event.status !== "SEARCHING" && event.status !== "CONFIRMED") {
    return NextResponse.json({ error: "This event isn't active" }, { status: 400 });
  }
  if (newOrganizerUserId === userId) {
    return NextResponse.json({ error: "You're already the organizer" }, { status: 400 });
  }

  // Never trust that the client only let someone click an eligible row --
  // re-check both that they're a real CONNECTED participant here and,
  // below, that they still have a write-target calendar right now.
  const newOrganizerParticipant = event.participants.find((p) => p.userId === newOrganizerUserId);
  if (!newOrganizerParticipant || newOrganizerParticipant.status !== "CONNECTED") {
    return NextResponse.json({ error: "That person isn't a connected participant on this event" }, { status: 400 });
  }

  const newWriteSource = await prisma.calendarSource.findFirst({
    where: { connectedCalendar: { userId: newOrganizerUserId, isEnabled: true }, isWriteTarget: true },
    include: { connectedCalendar: true },
  });
  if (!newWriteSource) {
    return NextResponse.json(
      { error: "That person doesn't have a calendar set to receive new events yet" },
      { status: 400 }
    );
  }

  const currentParticipant = event.participants.find((p) => p.userId === userId) ?? null;

  if (event.status === "SEARCHING") {
    // Nothing's been written to a calendar yet -- just hand off the role.
    const updated = await prisma.event.update({
      where: { id: event.id },
      data: { creatorId: newOrganizerUserId },
    });
    if (currentParticipant) {
      // Cascades to delete A's EventVote rows automatically.
      await prisma.eventParticipant.delete({ where: { id: currentParticipant.id } });
    }
    return NextResponse.json({ event: updated });
  }

  // CONFIRMED: real calendar surgery. Create on C's calendar first -- if
  // that fails, nothing has been destroyed yet and we can just fail clean
  // with the old event still intact on A's calendar.
  if (!event.writeCalendarSourceId || !event.confirmedStart || !event.confirmedEnd) {
    return NextResponse.json({ error: "This event has no confirmed time to hand off" }, { status: 400 });
  }

  const oldWriteSource = await prisma.calendarSource.findUnique({
    where: { id: event.writeCalendarSourceId },
    include: { connectedCalendar: true },
  });

  const remainingParticipants = event.participants.filter((p) => p.id !== currentParticipant?.id);
  // Mirrors confirm/route.ts's attendeeEmails filter -- the new organizer's
  // own email isn't included as an attendee since it's implicitly the
  // calendar owner. Apple has no real attendee list, so its branch below
  // uses remainingParticipants as-is instead.
  const attendeeEmails = remainingParticipants
    .map((p) => p.email)
    .filter((email) => email !== newOrganizerParticipant.email);

  const { connectedCalendar } = newWriteSource;
  let externalEventId: string | undefined;
  let externalEventHref: string | undefined;
  let externalEventEtag: string | null = null;

  try {
    if (connectedCalendar.provider === "GOOGLE" && connectedCalendar.nextAuthAccountId) {
      externalEventId = await createGoogleEvent(connectedCalendar.nextAuthAccountId, newWriteSource.externalId, {
        title: event.title,
        description: event.description ?? undefined,
        location: event.location ?? undefined,
        start: event.confirmedStart,
        end: event.confirmedEnd,
        attendeeEmails,
      });
    } else if (connectedCalendar.provider === "MICROSOFT" && connectedCalendar.nextAuthAccountId) {
      externalEventId = await createMicrosoftEvent(connectedCalendar.nextAuthAccountId, newWriteSource.externalId, {
        title: event.title,
        description: event.description ?? undefined,
        location: event.location ?? undefined,
        start: event.confirmedStart,
        end: event.confirmedEnd,
        attendeeEmails,
      });
    } else if (connectedCalendar.provider === "APPLE_CALDAV") {
      const participantsForDescription = remainingParticipants.map((p) => ({
        email: p.email,
        name: p.user?.name ?? null,
      }));
      const result = await createAppleEvent(connectedCalendar.id, newWriteSource.externalId, {
        title: event.title,
        description: event.description ?? undefined,
        location: event.location ?? undefined,
        start: event.confirmedStart,
        end: event.confirmedEnd,
        participants: participantsForDescription,
      });
      externalEventId = result.externalEventId;
      externalEventHref = result.externalEventHref;
      externalEventEtag = result.externalEventEtag;
    } else {
      return NextResponse.json({ error: "That calendar type doesn't support creating events yet" }, { status: 400 });
    }
  } catch (err) {
    console.error("Failed to create event on the new organizer's calendar during reassign:", err);
    return NextResponse.json(
      { error: "Couldn't create this event on their calendar -- nothing was changed." },
      { status: 500 }
    );
  }

  // Best-effort cleanup of the old event -- the hand-off already succeeded
  // on C's calendar at this point, so don't block on this the same way
  // cancel/route.ts and leave/route.ts don't block on their own deletes.
  if (oldWriteSource && event.externalEventId) {
    try {
      if (oldWriteSource.connectedCalendar.provider === "GOOGLE" && oldWriteSource.connectedCalendar.nextAuthAccountId) {
        await deleteGoogleEvent(oldWriteSource.connectedCalendar.nextAuthAccountId, oldWriteSource.externalId, event.externalEventId);
      } else if (
        oldWriteSource.connectedCalendar.provider === "MICROSOFT" &&
        oldWriteSource.connectedCalendar.nextAuthAccountId
      ) {
        await deleteMicrosoftEvent(oldWriteSource.connectedCalendar.nextAuthAccountId, event.externalEventId);
      } else if (oldWriteSource.connectedCalendar.provider === "APPLE_CALDAV" && event.externalEventHref) {
        await deleteAppleEvent(oldWriteSource.connectedCalendar.id, {
          href: event.externalEventHref,
          etag: event.externalEventEtag,
        });
      }
    } catch (err) {
      console.error("Failed to delete the old organizer's calendar event during reassign:", err);
    }
  }

  const updated = await prisma.event.update({
    where: { id: event.id },
    data: {
      creatorId: newOrganizerUserId,
      writeCalendarSourceId: newWriteSource.id,
      externalEventId: externalEventId ?? null,
      externalEventHref: externalEventHref ?? null,
      externalEventEtag,
      writeError: null,
    },
  });

  if (currentParticipant) {
    // Cascades to delete A's EventVote rows automatically. C's own
    // EventParticipant/EventVote rows are untouched.
    await prisma.eventParticipant.delete({ where: { id: currentParticipant.id } });
  }

  return NextResponse.json({ event: updated });
}
