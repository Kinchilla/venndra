import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";
import { removeAttendeeFromUpstreamEvent } from "../../../../../lib/upstreamEvents";

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

  // Only does anything once a real calendar event exists (CONFIRMED with a
  // write target) -- a still-SEARCHING event has no calendar invite yet, so
  // there's nothing upstream to remove them from. Runs BEFORE the delete
  // below, since the Apple branch rebuilds the description from whoever is
  // left and needs this row still present to exclude it.
  await removeAttendeeFromUpstreamEvent(event, participant);

  // Cascades to delete this participant's EventVote rows automatically
  // (see EventVote.participantId's onDelete: Cascade in schema.prisma).
  await prisma.eventParticipant.delete({ where: { id: participant.id } });

  return NextResponse.json({ ok: true });
}