import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { prisma } from "../../../../lib/prisma";
import { normalizeEmail } from "../../../../lib/emailIdentity";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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