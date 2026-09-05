import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { removeAttendeeFromUpstreamEvent } from "../../../../../lib/upstreamEvents";
import { currentUser, unauthorized } from "../../../../../lib/session";
import { notifyUser } from "../../../../../lib/notifications/send";
import { participantLeftEventEmail } from "../../../../../lib/notifications/templates";

export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const sessionUser = await currentUser();
  if (!sessionUser?.email) return unauthorized();

  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Organizers use Cancel/Reschedule instead -- leaving is a non-organizer action only.
  if (event.creatorId === sessionUser.id) {
    return NextResponse.json({ error: "Organizers can't leave their own event -- cancel it instead" }, { status: 403 });
  }

  if (event.status !== "SEARCHING" && event.status !== "CONFIRMED") {
    return NextResponse.json({ error: "There's nothing to leave -- this event isn't active" }, { status: 400 });
  }

  const participant = await prisma.eventParticipant.findUnique({
    where: { eventId_email: { eventId: params.id, email: sessionUser.email } },
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

  // The organizer check above guarantees creatorId !== the leaving user, so
  // this is never self-notifying.
  await notifyUser(event.creatorId, "participant_left_event", () => participantLeftEventEmail(sessionUser, { id: event.id, title: event.title }));

  return NextResponse.json({ ok: true });
}