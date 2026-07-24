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

  await prisma.friendship.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}