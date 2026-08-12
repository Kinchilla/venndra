import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";
import { deleteUpstreamEvent } from "../../../../../lib/upstreamEvents";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const userId = (session.user as any).id;
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
  return NextResponse.json({ event: updated });
}
