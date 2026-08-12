import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "../../../../lib/auth";
import { prisma } from "../../../../lib/prisma";
import { parsePhone } from "../../../../lib/phone";
import { resendPhoneVerification, startPhoneVerification } from "../../../../lib/phoneVerification";

/**
 * The phone number on the signed-in account.
 *
 * Separate from PATCH /api/me, which saves name and timezone, because this
 * field doesn't behave like those: writing it sends a text, costs money, and
 * invalidates a verification the user may have completed weeks ago. Folding it
 * into the profile save would mean pressing "Save" after editing your timezone
 * could quietly re-text a number that was already fine.
 */

const saveSchema = z.object({
  // The digits as typed -- formatting and all. parsePhone owns turning that
  // into E.164, so the client and this route can't drift on what's valid.
  phone: z.string().min(1).max(40),
  country: z.string().length(2),
});

/** Save a number (or replace the existing one) and text it a verification link. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id;

  const parsed = saveSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter a phone number." }, { status: 400 });

  const phone = parsePhone(parsed.data.phone, parsed.data.country.toUpperCase());
  if (!phone.ok) return NextResponse.json({ error: phone.error }, { status: 400 });

  // Re-saving the number already on the account, when it's already verified,
  // is a no-op rather than a fresh text. Someone opening Settings and pressing
  // Save without touching the field shouldn't be charged a message and shouldn't
  // lose a verification they already have.
  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: { phone: true, phoneVerifiedAt: true },
  });
  if (current?.phone === phone.e164 && current.phoneVerifiedAt) {
    return NextResponse.json({ ok: true, phone: phone.e164, verified: true, sent: false });
  }

  const result = await startPhoneVerification(userId, phone.e164, parsed.data.country.toUpperCase());
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ ok: true, phone: phone.e164, verified: false, sent: true });
}

/** Text a fresh link to the number already saved -- the "resend" affordance. */
export async function PUT() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await resendPhoneVerification((session.user as any).id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ ok: true, sent: true });
}

/**
 * Remove the number.
 *
 * Clears the verified flag and the outstanding tokens with it (the latter by
 * cascade). Removing a number has to actually remove it -- this is the control
 * someone uses when they no longer want to be discoverable, and leaving a live
 * token behind would mean an old text could put it back.
 */
export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as any).id;

  await prisma.$transaction([
    prisma.phoneVerificationToken.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: { phone: null, phoneCountry: null, phoneVerifiedAt: null },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
