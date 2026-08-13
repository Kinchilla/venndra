import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { prisma } from "../../../../lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id;

  const myFriendships = await prisma.friendship.findMany({
    where: { status: "ACCEPTED", OR: [{ requesterId: userId }, { addresseeId: userId }] },
  });
  const myFriendIds = myFriendships.map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId));

  // No friends yet means no "friends of friends" to suggest at all.
  if (myFriendIds.length === 0) {
    return NextResponse.json({ suggestions: [] });
  }

  const friendsOfFriends = await prisma.friendship.findMany({
    where: { status: "ACCEPTED", OR: [{ requesterId: { in: myFriendIds } }, { addresseeId: { in: myFriendIds } }] },
  });

  // Tally how many of MY friends each candidate is also friends with --
  // that count is the ranking signal, never shown to the user directly.
  const sharedCount = new Map<string, number>();
  for (const f of friendsOfFriends) {
    let candidate: string | null = null;
    if (myFriendIds.includes(f.requesterId) && !myFriendIds.includes(f.addresseeId)) candidate = f.addresseeId;
    else if (myFriendIds.includes(f.addresseeId) && !myFriendIds.includes(f.requesterId)) candidate = f.requesterId;
    if (candidate && candidate !== userId) {
      sharedCount.set(candidate, (sharedCount.get(candidate) ?? 0) + 1);
    }
  }

  const [pending, dismissed] = await Promise.all([
    prisma.friendship.findMany({ where: { status: "PENDING", OR: [{ requesterId: userId }, { addresseeId: userId }] } }),
    prisma.dismissedSuggestion.findMany({ where: { userId }, select: { dismissedUserId: true } }),
  ]);
  const excluded = new Set<string>([
    ...pending.map((f) => (f.requesterId === userId ? f.addresseeId : f.requesterId)),
    ...dismissed.map((d) => d.dismissedUserId),
  ]);

  const ranked = [...sharedCount.entries()]
    .filter(([id]) => !excluded.has(id))
    // Ties break on id: arbitrary, but *stable*. The list is refetched every
    // time a chip is dismissed or requested, to backfill the freed slot, and a
    // random tiebreak would let equally-ranked people come back in a different
    // order on each of those calls -- reshuffling the chips still on screen,
    // and making "the next suggestion" a coin flip rather than a position.
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([id]) => id);

  const users = await prisma.user.findMany({
    where: { id: { in: ranked } },
    select: { id: true, name: true, email: true, image: true },
  });
  // findMany's `in` filter doesn't preserve the order of the ids you gave
  // it, so re-order the results to match the actual ranking.
  const byId = new Map(users.map((u) => [u.id, u]));
  const suggestions = ranked.map((id) => byId.get(id)).filter(Boolean);

  return NextResponse.json({ suggestions });
}