import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";

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

const requestSchema = z.object({ email: z.string().email() });

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id;

  const parsed = requestSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });

  const target = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!target) {
    return NextResponse.json({ error: `No Venndra profile associated with ${parsed.data.email}` }, { status: 404 });
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