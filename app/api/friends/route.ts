import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import { emailField } from "../../../lib/emailIdentity";

const USER_SELECT = { id: true, name: true, email: true, image: true, pausedAt: true };

/**
 * Hands out whether someone is paused, never since when. Friends need the
 * flag -- it's what greys them out in the picker -- but the timestamp is the
 * paused person's own business, and there's nothing on this side of the app
 * that could do anything useful with it.
 */
function toFriendUser<T extends { pausedAt: Date | null }>({ pausedAt, ...user }: T) {
  return { ...user, paused: pausedAt !== null };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id;

  const [sent, received] = await Promise.all([
    prisma.friendship.findMany({ where: { requesterId: userId }, include: { addressee: { select: USER_SELECT } } }),
    prisma.friendship.findMany({ where: { addresseeId: userId }, include: { requester: { select: USER_SELECT } } }),
  ]);

  const friends = [
    ...sent.filter((f) => f.status === "ACCEPTED").map((f) => ({ friendshipId: f.id, user: toFriendUser(f.addressee) })),
    ...received.filter((f) => f.status === "ACCEPTED").map((f) => ({ friendshipId: f.id, user: toFriendUser(f.requester) })),
  ];
  const pendingSent = sent
    .filter((f) => f.status === "PENDING")
    .map((f) => ({ friendshipId: f.id, user: toFriendUser(f.addressee) }));
  const pendingReceived = received
    .filter((f) => f.status === "PENDING")
    .map((f) => ({ friendshipId: f.id, user: toFriendUser(f.requester) }));

  return NextResponse.json({ friends, pendingSent, pendingReceived });
}

// Two ways to name the person you're adding, and the difference is issue #6.
//
// `email` is the add-a-friend form: you type an address you already know, and
// it's the only thing you have to go on. emailField, not z.string().email():
// the address is about to be used as a lookup key, and typing a friend's
// address the way it appears in their signature -- "Friend@gmail.com" -- used
// to return "No Venndra profile found for this email yet" for someone who
// plainly had one. Issue #25.
//
// `userId` is Suggested Friends, and it exists so that flow can stop being
// handed addresses. Suggestions are friends-of-friends -- people you have
// never met and whose email you have no business receiving -- but requesting
// one used to mean POSTing their address, so the suggestions endpoint had to
// send it to the browser first. Hiding it in the markup would have changed
// nothing: it was in the JSON. Accepting an id instead is what let
// app/api/friends/suggestions stop selecting the column at all.
//
// A cuid is not a secret, but it isn't guessable either, and it discloses
// nothing on its own -- which is the whole difference from an address.
const requestSchema = z.union([
  z.object({ email: emailField }),
  z.object({ userId: z.string().min(1) }),
]);

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id;

  const parsed = requestSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });

  const target = await prisma.user.findUnique({
    where: "userId" in parsed.data ? { id: parsed.data.userId } : { email: parsed.data.email },
  });
  if (!target) {
    // Worded to match the inline hint on the add-friend form exactly
    // (components/NewFriendForm) -- that check runs as you type and this one
    // fires if you submit anyway, so the same fact used to arrive twice in two
    // different sentences. Change one and change the other. The address isn't
    // interpolated any more: the only caller has it in a field on screen.
    //
    // The id branch reaches this only if a suggestion went stale between being
    // listed and being clicked -- the account was deleted in between. Same
    // 404, and the wording is odd for that case but it is not a case anyone
    // sees: the chip disappears on the refetch either way.
    return NextResponse.json({ error: "No Venndra profile found for this email yet" }, { status: 404 });
  }
  if (target.id === userId) {
    return NextResponse.json({ error: "You can't add yourself as a friend." }, { status: 400 });
  }

  // Check the reverse direction first -- if they already requested you,
  // this action should just complete that request rather than create a
  // second, conflicting row.
  const reverse = await prisma.friendship.findUnique({
    where: { requesterId_addresseeId: { requesterId: target.id, addresseeId: userId } },
  });
  if (reverse) {
    if (reverse.status === "ACCEPTED") {
      return NextResponse.json({ error: "You're already friends." }, { status: 409 });
    }
    const updated = await prisma.friendship.update({ where: { id: reverse.id }, data: { status: "ACCEPTED" } });
    return NextResponse.json({ friendship: updated, autoAccepted: true });
  }

  const existing = await prisma.friendship.findUnique({
    where: { requesterId_addresseeId: { requesterId: userId, addresseeId: target.id } },
  });
  if (existing) {
    return NextResponse.json(
      { error: existing.status === "ACCEPTED" ? "You're already friends." : "You've already sent a request to this person." },
      { status: 409 }
    );
  }

  const friendship = await prisma.friendship.create({
    data: { requesterId: userId, addresseeId: target.id, status: "PENDING" },
  });
  return NextResponse.json({ friendship }, { status: 201 });
}