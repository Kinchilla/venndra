import { nanoid } from "nanoid";
import { prisma } from "./prisma";
import { checkRateLimit } from "./rateLimit";
import { sendSms } from "./sms";
import { formatE164ForDisplay } from "./phone";

/**
 * Proving a phone number belongs to the person who typed it.
 *
 * The shape is the magic link's, over SMS: a one-off link is texted to the
 * number, and the number is marked verified when that link is opened. What
 * makes it necessary is that the field's whole purpose is discovery -- friends
 * find you by your number -- so an unproven number is an offer to be findable
 * AS somebody else. Typing an ex's number into your own profile and becoming
 * the account their friends add is exactly the harassment vector this closes.
 *
 * Until verified, a number is inert everywhere: no contact matching, nothing
 * sent to it. That rule lives at the queries that read the column, and the
 * reason it can be relied on is here -- phoneVerifiedAt is set in exactly one
 * place, redeemPhoneToken() below.
 */

/** Verification texts per user per minute, matching the magic link's send limit. */
const SEND_LIMIT_PER_MINUTE = 3;

/**
 * Redemption attempts per user per minute.
 *
 * Guessing a 24-character nanoid is not a threat anyone is going to realise;
 * this is here so a script pointed at the endpoint burns a rate-limit row
 * instead of a database query per attempt, and because #12's 429 verification
 * should have every token-consuming route to look at, not most of them.
 */
const REDEEM_LIMIT_PER_MINUTE = 10;

/**
 * How long a link stays usable.
 *
 * Longer than the magic link's 10 minutes, deliberately. That one is a bearer
 * credential -- anyone holding it becomes the account -- so its window is
 * scoped to the damage it can do. This one can do exactly one thing: set a
 * verified flag on an account the clicker must ALREADY be signed into. Against
 * that, carrier delivery genuinely lags by minutes, and a link that expires
 * before the text arrives is a loop the user can't escape by trying harder.
 */
const LINK_MAX_AGE_MS = 15 * 60 * 1000;

/** Exported so the UI and the message itself state the same number. */
export const LINK_MAX_AGE_MINUTES = Math.round(LINK_MAX_AGE_MS / 60_000);

export type StartResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Attach a number to an account and text it a link.
 *
 * Also the "changed my number" path: setting a new one clears phoneVerifiedAt
 * and destroys any outstanding token, so a link sent to the old number can't
 * be used to mark the new one verified.
 */
export async function startPhoneVerification(userId: string, e164: string, iso: string): Promise<StartResult> {
  // Keyed on the user, not the destination number. The magic link keys on the
  // address because there may be no account yet; here there always is one, and
  // keying on the number would let someone sidestep the limit by editing the
  // field between sends -- which is precisely the abuse worth stopping, since
  // every send goes to a number that may not be theirs.
  const allowed = await checkRateLimit("phone-verify-send", userId, SEND_LIMIT_PER_MINUTE);
  if (!allowed) {
    return { ok: false, status: 429, error: "Too many texts requested. Wait a minute and try again." };
  }

  // Refused up front as well as at redeem time. Both are needed: this one
  // gives an immediate, actionable error instead of a text that arrives and
  // then fails on click, and the redeem-time check is the one that actually
  // holds, because someone else can verify the same number in between.
  const takenBy = await prisma.user.findFirst({
    where: { phone: e164, phoneVerifiedAt: { not: null }, id: { not: userId } },
    select: { id: true },
  });
  if (takenBy) {
    return { ok: false, status: 409, error: "That number is already verified on another Venndra account." };
  }

  const token = nanoid(24);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { phone: e164, phoneCountry: iso, phoneVerifiedAt: null },
    }),
    // Every outstanding link for this user dies here, not just the ones for
    // other numbers. Two live links is two chances for the wrong one to be
    // clicked, and "resend" should mean the newest text is the one that works.
    prisma.phoneVerificationToken.deleteMany({ where: { userId } }),
    prisma.phoneVerificationToken.create({
      data: { token, userId, phone: e164, expires: new Date(Date.now() + LINK_MAX_AGE_MS) },
    }),
  ]);

  await sendSms({ to: e164, body: message(token, e164, iso) });
  return { ok: true };
}

/** Send a fresh link to the number already on the account. */
export async function resendPhoneVerification(userId: string): Promise<StartResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { phone: true, phoneCountry: true, phoneVerifiedAt: true },
  });

  if (!user?.phone) return { ok: false, status: 400, error: "There's no number on your account to verify." };
  if (user.phoneVerifiedAt) return { ok: false, status: 400, error: "That number is already verified." };

  return startPhoneVerification(userId, user.phone, user.phoneCountry ?? "US");
}

export type RedeemResult =
  | { ok: true; phone: string }
  | { ok: false; error: string };

/**
 * Consume a token and mark the number verified.
 *
 * Single-use, unlike the magic link -- which stopped consuming its tokens
 * because link scanners were spending them before the recipient could. That
 * reasoning doesn't transfer: this token is redeemed by an explicit POST from
 * a page the signed-in user is looking at (see app/verify-phone), never by the
 * GET that a scanner would follow, so nothing but a real click reaches here.
 *
 * `userId` is the SIGNED-IN user, and a token belonging to anyone else is
 * refused rather than honoured. Without that check, forwarding the text to a
 * friend would verify the number on the sender's account from the friend's
 * browser -- and more to the point, a token is not a way to act on an account
 * you aren't in.
 */
export async function redeemPhoneToken(token: string, userId: string): Promise<RedeemResult> {
  const allowed = await checkRateLimit("phone-verify-redeem", userId, REDEEM_LIMIT_PER_MINUTE);
  if (!allowed) return { ok: false, error: "Too many attempts. Wait a minute and try again." };

  const record = await prisma.phoneVerificationToken.findUnique({ where: { token } });

  // One message for missing, expired, and someone else's, on purpose: the
  // three are indistinguishable to a legitimate user (all mean "ask for
  // another text") and telling them apart would confirm to a stranger which
  // tokens exist.
  const invalid = { ok: false as const, error: "That link is no longer valid. Ask for a new one from Settings." };
  if (!record || record.userId !== userId || record.expires < new Date()) return invalid;

  // The number is re-read from the token rather than from the user row, so a
  // field edited while the text was in flight can't be the thing that gets
  // verified. If they no longer match, the user moved on -- the link is stale.
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
  if (user?.phone !== record.phone) {
    await prisma.phoneVerificationToken.delete({ where: { token } }).catch(() => {});
    return { ok: false, error: "That link was for a different number. Ask for a new one from Settings." };
  }

  const takenBy = await prisma.user.findFirst({
    where: { phone: record.phone, phoneVerifiedAt: { not: null }, id: { not: userId } },
    select: { id: true },
  });
  if (takenBy) return { ok: false, error: "That number is already verified on another Venndra account." };

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { phoneVerifiedAt: new Date() } }),
    prisma.phoneVerificationToken.delete({ where: { token } }),
    // Anyone else who had typed this number in and never proved it loses it
    // now. It can only belong to one person, that person just demonstrated it,
    // and leaving the others pending would leave a link in someone's inbox
    // that can never succeed. Their tokens go with it, by cascade.
    prisma.user.updateMany({
      where: { phone: record.phone, id: { not: userId } },
      data: { phone: null, phoneCountry: null },
    }),
  ]);

  return { ok: true, phone: record.phone };
}

/**
 * The text itself.
 *
 * Kept short because a segment is 160 characters and every extra one is
 * another fraction of a cent per user, but more importantly because a wall of
 * text with a link in it is what a phishing message looks like. It names the
 * app, states the number being confirmed so a mis-typed digit is visible
 * before the link is opened, and says what to do if it wasn't you.
 */
function message(token: string, e164: string, iso: string): string {
  return [
    `Venndra: confirm ${formatE164ForDisplay(e164, iso)} so friends can find you.`,
    verifyUrl(token),
    `Expires in ${LINK_MAX_AGE_MINUTES} min. Not you? Ignore this.`,
  ].join(" ");
}

/**
 * Absolute, because it is going into a text message -- there is no page for a
 * relative URL to be relative to. NEXTAUTH_URL is the origin the rest of the
 * app already builds absolute links from.
 */
function verifyUrl(token: string): string {
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/verify-phone?token=${token}`;
}
