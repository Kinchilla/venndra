import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id;

  const friendship = await prisma.friendship.findUnique({ where: { id: params.id } });
  if (!friendship) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (friendship.addresseeId !== userId) {
    return NextResponse.json({ error: "Only the recipient of a request can accept it" }, { status: 403 });
  }

  const updated = await prisma.friendship.update({ where: { id: params.id }, data: { status: "ACCEPTED" } });
  return NextResponse.json({ friendship: updated });
}