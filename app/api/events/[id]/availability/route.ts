import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { computeGroupAvailability } from "../../../../../lib/availability";
import { checkRateLimit } from "../../../../../lib/rateLimit";
import { asWeeklyHours } from "../../../../../lib/searchWindow";
import { currentUser, unauthorized } from "../../../../../lib/session";

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const sessionUser = await currentUser();
  if (!sessionUser) return unauthorized();

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    include: { participants: { include: { user: { select: { name: true } } } } },
  });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const userId = sessionUser.id;
  const isInvolved =
    event.creatorId === userId || event.participants.some((p) => p.email === sessionUser.email);
  if (!isInvolved) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const allowed = await checkRateLimit("availability", userId, 30);
  if (!allowed) {
    return NextResponse.json({ error: "You're checking this too frequently — wait a moment and try again." }, { status: 429 });
  }

  let slots = await computeGroupAvailability({
    creatorTimezone: event.timezone,
    filters: asWeeklyHours(event.filters) ?? {},
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
      participants: s.participants,
    })),
  });
}
