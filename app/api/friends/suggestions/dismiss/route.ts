import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../../../lib/prisma";
import { jsonBody } from "../../../../../lib/requestBody";
import { currentUser, unauthorized } from "../../../../../lib/session";

const schema = z.object({ userId: z.string() });

export async function POST(req: NextRequest) {
  const sessionUser = await currentUser();
  if (!sessionUser) return unauthorized();
  const userId = sessionUser.id;

  const parsed = schema.safeParse(await jsonBody(req));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  await prisma.dismissedSuggestion.upsert({
    where: { userId_dismissedUserId: { userId, dismissedUserId: parsed.data.userId } },
    create: { userId, dismissedUserId: parsed.data.userId },
    update: {},
  });

  return NextResponse.json({ ok: true });
}