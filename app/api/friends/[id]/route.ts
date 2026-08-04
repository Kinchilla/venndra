import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { prisma } from "../../../../lib/prisma";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id;

  const friendship = await prisma.friendship.findUnique({ where: { id: params.id } });
  if (!friendship) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Either side of the relationship can end it -- the requester cancelling,
  // the addressee declining, or either side unfriending an accepted one.
  if (friendship.requesterId !== userId && friendship.addresseeId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Only an ACCEPTED friendship ending means someone actually stops being a
  // friend -- a still-PENDING request being cancelled/declined never had
  // group membership tied to it (FriendPicker only ever offers accepted
  // friends), so there's nothing to clean up there.
  if (friendship.status === "ACCEPTED") {
    const [requester, addressee] = await Promise.all([
      prisma.user.findUnique({ where: { id: friendship.requesterId }, select: { email: true } }),
      prisma.user.findUnique({ where: { id: friendship.addresseeId }, select: { email: true } }),
    ]);

    await prisma.friendship.delete({ where: { id: params.id } });

    // Remove each side's email from the other's saved groups -- otherwise a
    // group keeps a stale, no-longer-a-friend email that FriendPicker
    // hides but that still gets submitted (and rejected) when the group is
    // applied to a new search. See lib/friends.ts's validateAllFriends for
    // the enforcement point this is keeping saved groups consistent with.
    await Promise.all([
      requester?.email ? removeEmailFromGroups(friendship.addresseeId, requester.email) : null,
      addressee?.email ? removeEmailFromGroups(friendship.requesterId, addressee.email) : null,
    ]);
  } else {
    await prisma.friendship.delete({ where: { id: params.id } });
  }

  return NextResponse.json({ ok: true });
}

async function removeEmailFromGroups(ownerId: string, emailToRemove: string): Promise<void> {
  const groups = await prisma.savedGroup.findMany({
    where: { userId: ownerId, emails: { has: emailToRemove } },
    select: { id: true, emails: true },
  });
  if (groups.length === 0) return;

  await prisma.$transaction(
    groups.map((g) =>
      prisma.savedGroup.update({
        where: { id: g.id },
        data: { emails: g.emails.filter((e) => e !== emailToRemove) },
      })
    )
  );
}