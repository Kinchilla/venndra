import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";

const schema = z.object({ userId: z.string() });

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id;

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  await prisma.dismissedSuggestion.upsert({
    where: { userId_dismissedUserId: { userId, dismissedUserId: parsed.data.userId } },
    create: { userId, dismissedUserId: parsed.data.userId },
    update: {},
  });

  return NextResponse.json({ ok: true });
}