import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { prisma } from "../../../../lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const email = req.nextUrl.searchParams.get("email");
  if (!email) return NextResponse.json({ exists: false, name: null });

  const user = await prisma.user.findUnique({ where: { email }, select: { name: true } });
  return NextResponse.json({ exists: !!user, name: user?.name ?? null });
}