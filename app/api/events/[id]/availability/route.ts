import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";
import { computeGroupAvailability } from "../../../../../lib/availability";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    include: { participants: { include: { user: { select: { name: true } } } } },
  });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const userId = (session.user as any).id;
  const isInvolved =
    event.creatorId === userId || event.participants.some((p) => p.email === session.user!.email);
  if (!isInvolved) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let slots = await computeGroupAvailability({
    creatorTimezone: event.timezone,
    filters: event.filters as any,
    durationMin: event.durationMin,
    searchStart: event.searchStart,
    searchEnd: event.searchEnd,
    participants: event.participants.map((p) => ({
      email: p.email,
      name: p.user?.name ?? null,
      userId: p.userId,
      status: p.status,
    })),
  });

  if (event.minAttendees) {
    slots = slots.filter((s) => s.availableCount >= event.minAttendees!);
  }

  // No sorting here on purpose -- the client (EventResults.tsx) re-sorts
  // every time regardless of what order this returns, since it needs to
  // combine this data with vote tallies (fetched separately) to support
  // "most votes" mode. A sort here would just be ignored, and having two
  // places that both think they're the one deciding order is exactly how
  // the score-vs-count mismatch bug happened -- keeping ordering logic in
  // exactly one place (the client) avoids that class of bug recurring.
  return NextResponse.json({
    minAttendees: event.minAttendees,
    totalParticipants: event.participants.length,
    slots: slots.map((s) => ({
      start: s.start.toISOString(),
      end: s.end.toISOString(),
      availableCount: s.availableCount,
      totalConnected: s.totalConnected,
      hasTentative: s.hasTentative,
      participants: s.participants,
    })),
  });
}
