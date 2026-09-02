import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { normalizeEmail } from "../../../../lib/emailIdentity";
import { currentUser, unauthorized } from "../../../../lib/session";

export async function GET(req: NextRequest) {
  const sessionUser = await currentUser();
  if (!sessionUser) return unauthorized();

  const email = req.nextUrl.searchParams.get("email");
  if (!email) return NextResponse.json({ exists: false, name: null });

  // Must normalise exactly as POST /api/friends does. This is the as-you-type
  // half of the same question, and the two disagreeing is worse than either
  // being wrong alone: the form would say "no profile" while the submit
  // succeeded, or the reverse. Not a zod schema like the POST body's, because
  // this reads a query string where an unparseable value is answered with
  // "no such person" rather than a 400 -- the field is checked on every
  // keystroke, and half-typed addresses are the normal case, not an error.
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) }, select: { name: true } });
  return NextResponse.json({ exists: !!user, name: user?.name ?? null });
}