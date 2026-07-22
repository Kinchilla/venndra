import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    include: { participants: true },
  });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const userId = (session.user as any).id;
  const myParticipant = event.participants.find((p) => p.email === session.user!.email);
  const isInvolved = event.creatorId === userId || !!myParticipant;
  if (!isInvolved) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const myVotes = myParticipant
    ? await prisma.eventVote.findMany({
        where: { participantId: myParticipant.id },
        orderBy: { rank: "asc" },
        select: { slotStart: true, rank: true },
      })
    : [];

  // Fetched raw (not via groupBy) specifically so we can show the
  // organizer WHO voted for a slot and at what rank, not just an
  // aggregate count -- groupBy can compute the count/score but throws
  // away which individual participant each vote belonged to.
  const allVotes = await prisma.eventVote.findMany({
    where: { eventId: event.id },
    include: { participant: { select: { email: true } } },
  });

  const voteTopX = event.voteTopX ?? 0;
  const bySlot = new Map<string, { email: string; rank: number }[]>();
  for (const v of allVotes) {
    const key = v.slotStart.toISOString();
    if (!bySlot.has(key)) bySlot.set(key, []);
    bySlot.get(key)!.push({ email: v.participant.email, rank: v.rank });
  }

  const tally = [...bySlot.entries()].map(([slotStart, voters]) => ({
    slotStart,
    voteCount: voters.length,
    // Borda-count-style: a rank-1 pick is worth voteTopX points, rank-2
    // worth voteTopX-1, ... down to 1 point for the lowest rank.
    score: voters.reduce((sum, v) => sum + (voteTopX + 1 - v.rank), 0),
    voters: voters.sort((a, b) => a.rank - b.rank),
  }));

  return NextResponse.json({
    votingEnabled: event.votingEnabled,
    voteTopX: event.voteTopX,
    canVote: myParticipant?.status === "CONNECTED",
    myVotes: myVotes.map((v) => ({ slotStart: v.slotStart.toISOString(), rank: v.rank })),
    tally,
  });
}

const ballotSchema = z.object({
  // ordered: index 0 is the 1st choice, index 1 the 2nd, etc.
  picks: z.array(z.string().datetime()).max(10),
});

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const event = await prisma.event.findUnique({ where: { id: params.id }, include: { participants: true } });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!event.votingEnabled) return NextResponse.json({ error: "Voting isn't enabled for this event" }, { status: 400 });

  const myParticipant = event.participants.find((p) => p.email === session.user!.email);
  if (!myParticipant) return NextResponse.json({ error: "You're not a participant on this event" }, { status: 403 });
  if (myParticipant.status !== "CONNECTED") {
    return NextResponse.json({ error: "Connect a calendar before voting" }, { status: 400 });
  }

  const parsed = ballotSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const maxPicks = event.voteTopX ?? 10;
  if (parsed.data.picks.length > maxPicks) {
    return NextResponse.json({ error: `You can only rank up to ${maxPicks} slots` }, { status: 400 });
  }
  if (new Set(parsed.data.picks).size !== parsed.data.picks.length) {
    return NextResponse.json({ error: "Each slot can only appear once in your ballot" }, { status: 400 });
  }

  // Replace the whole ballot atomically -- simpler and safer than trying
  // to diff/patch individual rank changes.
  await prisma.$transaction([
    prisma.eventVote.deleteMany({ where: { participantId: myParticipant.id } }),
    ...parsed.data.picks.map((slotStart, index) =>
      prisma.eventVote.create({
        data: {
          eventId: event.id,
          participantId: myParticipant.id,
          slotStart: new Date(slotStart),
          rank: index + 1,
        },
      })
    ),
  ]);

  return NextResponse.json({ ok: true });
}
