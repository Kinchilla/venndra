import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "../../../../lib/auth";
import { prisma } from "../../../../lib/prisma";

const schema = z.object({ paused: z.boolean() });

/**
 * Pause or unpause the signed-in account. See lib/pause.ts for what that
 * actually changes -- a much smaller blast radius than sharing a box with
 * Delete my account might suggest.
 *
 * One route taking a boolean rather than a pair of pause/unpause endpoints:
 * the client always knows which state it wants (it's rendering one button or
 * the other), and sending that directly makes a double-click idempotent
 * instead of a toggle that lands wherever the race leaves it.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // Stamped fresh on every pause rather than preserved across an
  // unpause/repause -- "paused since" means since this pause, not since the
  // first one they ever did.
  const user = await prisma.user.update({
    where: { id: (session.user as any).id },
    data: { pausedAt: parsed.data.paused ? new Date() : null },
    select: { pausedAt: true },
  });

  return NextResponse.json({ paused: user.pausedAt !== null, pausedAt: user.pausedAt });
}
