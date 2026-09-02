import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { currentUser, unauthorized } from "../../../../../lib/session";

export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const sessionUser = await currentUser();
  if (!sessionUser) return unauthorized();
  const userId = sessionUser.id;

  const friendship = await prisma.friendship.findUnique({ where: { id: params.id } });
  if (!friendship) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (friendship.addresseeId !== userId) {
    return NextResponse.json({ error: "Only the recipient of a request can accept it" }, { status: 403 });
  }

  const updated = await prisma.friendship.update({ where: { id: params.id }, data: { status: "ACCEPTED" } });
  return NextResponse.json({ friendship: updated });
}