import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { deleteUpstreamEvent } from "../../../../../lib/upstreamEvents";
import { currentUser, unauthorized } from "../../../../../lib/session";
import { notifyUsers } from "../../../../../lib/notifications/send";
import { eventCancelledEmail } from "../../../../../lib/notifications/templates";

export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const sessionUser = await currentUser();
  if (!sessionUser) return unauthorized();

  const event = await prisma.event.findUnique({ where: { id: params.id }, include: { participants: true } });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const userId = sessionUser.id;
  if (event.creatorId !== userId) {
    return NextResponse.json({ error: "Only the event creator can cancel" }, { status: 403 });
  }
  if (event.status === "CANCELLED") {
    return NextResponse.json({ error: "Already cancelled" }, { status: 409 });
  }

  // If a real calendar event was created, actually delete it so every
  // attendee gets that provider's own cancellation email -- rather than
  // leaving a stale event on everyone's calendar with no explanation. Uses
  // the specific calendar it was written to at confirm time, not whatever's
  // currently marked as the write target, and never blocks the cancel over
  // an upstream event that's already gone. See lib/upstreamEvents.
  await deleteUpstreamEvent(event);

  const updated = await prisma.event.update({ where: { id: event.id }, data: { status: "CANCELLED" } });

  const otherParticipantIds = event.participants
    .map((p) => p.userId)
    .filter((id): id is string => !!id && id !== userId);
  await notifyUsers(otherParticipantIds, "event_cancelled", () => eventCancelledEmail(sessionUser, { id: event.id, title: event.title }));

  return NextResponse.json({ event: updated });
}
