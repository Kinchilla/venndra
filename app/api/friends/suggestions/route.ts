import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { displayName } from "../../../../lib/displayName";
import { currentUser, unauthorized } from "../../../../lib/session";

export async function GET() {
  const sessionUser = await currentUser();
  if (!sessionUser) return unauthorized();
  const userId = sessionUser.id;

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

  // The label is resolved HERE rather than in the browser, and that is the
  // whole of issue #6's fix for this endpoint.
  //
  // Everyone listed is a friend-of-a-friend the caller has never met and has
  // no address for -- that is the entire premise of a suggestion. Sending
  // `email` and letting the chip decide what to render would leak it whether
  // or not the markup used it: it would be sitting in the JSON. So the server
  // resolves the one string the viewer is allowed to see and sends only that.
  //
  // Note this is NOT the same as never sending an address. An account with no
  // display name has been told, in components/DisplayNameBanner, that its
  // email is what people see -- so for that account displayName returns the
  // address and this endpoint passes it on, because withholding it would
  // reverse a choice the person made and leave them showing up to the whole
  // app as "Someone". What can't happen any more is the case that made this a
  // bug: an account WITH a name having its address sent out beside it.
  //
  // Requesting a suggestion therefore POSTs { userId } rather than { email }
  // -- see the schema in ../route.ts.
  const users = await prisma.user.findMany({
    where: { id: { in: ranked } },
    select: { id: true, name: true, email: true, image: true },
  });
  // findMany's `in` filter doesn't preserve the order of the ids you gave
  // it, so re-order the results to match the actual ranking.
  const byId = new Map(
    users.map((u) => [u.id, { id: u.id, displayName: displayName(u), image: u.image }])
  );
  const suggestions = ranked.map((id) => byId.get(id)).filter(Boolean);

  return NextResponse.json({ suggestions });
}