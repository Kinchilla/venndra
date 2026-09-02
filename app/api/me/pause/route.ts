import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../../lib/prisma";
import { jsonBody } from "../../../../lib/requestBody";
import { currentUser, unauthorized } from "../../../../lib/session";

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
  const sessionUser = await currentUser();
  if (!sessionUser) return unauthorized();

  const parsed = schema.safeParse(await jsonBody(req));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // Stamped fresh on every pause rather than preserved across an
  // unpause/repause -- "paused since" means since this pause, not since the
  // first one they ever did.
  const user = await prisma.user.update({
    where: { id: sessionUser.id },
    data: { pausedAt: parsed.data.paused ? new Date() : null },
    select: { pausedAt: true },
  });

  return NextResponse.json({ paused: user.pausedAt !== null, pausedAt: user.pausedAt });
}
