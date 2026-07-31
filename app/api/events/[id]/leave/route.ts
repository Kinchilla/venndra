import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";
import { removeGoogleAttendee } from "../../../../../lib/calendar/google";
import { removeMicrosoftAttendee } from "../../../../../lib/calendar/microsoft";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Organizers use Cancel/Reschedule instead -- leaving is a non-organizer action only.
  if (event.creatorId === (session.user as any).id) {
    return NextResponse.json({ error: "Organizers can't leave their own event -- cancel it instead" }, { status: 403 });
  }

  if (event.status !== "SEARCHING" && event.status !== "CONFIRMED") {
    return NextResponse.json({ error: "There's nothing to leave -- this event isn't active" }, { status: 400 });
  }

  const participant = await prisma.eventParticipant.findUnique({
    where: { eventId_email: { eventId: params.id, email: session.user.email } },
  });
  if (!participant) {
    return NextResponse.json({ error: "You're not on this event" }, { status: 404 });
  }

  // Only relevant once a real calendar event exists (CONFIRMED with a
  // write target). A still-SEARCHING event has no calendar invite yet, so
  // there's nothing upstream to remove them from.
  if (event.status === "CONFIRMED" && event.writeCalendarSourceId) {
    const writeSource = await prisma.calendarSource.findUnique({
      where: { id: event.writeCalendarSourceId },
      include: { connectedCalendar: true },
    });
    try {
      if (
        writeSource?.connectedCalendar.provider === "GOOGLE" &&
        writeSource.connectedCalendar.nextAuthAccountId &&
        event.externalEventId
      ) {
        await removeGoogleAttendee(
          writeSource.connectedCalendar.nextAuthAccountId,
          writeSource.externalId,
          event.externalEventId,
          session.user.email
        );
      } else if (
        writeSource?.connectedCalendar.provider === "MICROSOFT" &&
        writeSource.connectedCalendar.nextAuthAccountId &&
        event.externalEventId
      ) {
        await removeMicrosoftAttendee(
          writeSource.connectedCalendar.nextAuthAccountId,
          event.externalEventId,
          session.user.email
        );
      }
    } catch (err) {
      // Same reasoning as cancel/route.ts: if the upstream event or
      // attendee is already gone somehow, don't block leaving in Venndra
      // over it.
      console.error("Failed to remove attendee from upstream calendar event during leave:", err);
    }
  }

  // Cascades to delete this participant's EventVote rows automatically
  // (see EventVote.participantId's onDelete: Cascade in schema.prisma).
  await prisma.eventParticipant.delete({ where: { id: participant.id } });

  return NextResponse.json({ ok: true });
}