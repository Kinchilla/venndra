import { z } from "zod";

/**
 * Email addresses as IDENTITY -- the single place the canonical form of an
 * address is decided, and the only thing anything else should call.
 *
 * Not to be confused with lib/email.ts, which is about SENDING mail. This file
 * is about matching: `User.email` is the key this app identifies people by
 * (see the long note in lib/auth.ts on why it is @unique), and a key is only
 * a key if every writer and every reader spell it the same way.
 *
 * Before this existed, nothing in app/ or lib/ normalised an address at all.
 * Every `where: { email: ... }` was an independent exact string match, which
 * produced a real user-facing bug -- adding a friend as "Friend@gmail.com"
 * returned "No Venndra profile found for this email yet" for a user who
 * plainly existed -- and left the no-duplicate-accounts invariant resting on
 * a default inside next-auth rather than on anything here. See issue #25.
 *
 * THE RULE: trim, then lowercase. Applied on write and on read, so the two
 * cannot disagree.
 *
 * Lowercasing the local part is technically a liberty. RFC 5321 §2.4 reserves
 * case sensitivity of the part before the @ to the receiving mail server, so
 * `Bob@x.com` and `bob@x.com` are permitted to be two different mailboxes. In
 * practice no provider anyone here will use treats them as different -- Gmail,
 * iCloud, Outlook and every major host fold case -- and the alternative is
 * strictly worse: a person who types their own address with a capital gets
 * told they have no account. The cost of being wrong is two mailboxes at an
 * unusual host colliding; the cost of being right by the RFC is the bug above,
 * for everyone, every day. The domain half is case-insensitive by DNS, so
 * that part is not a judgement call.
 *
 * WHERE IT HAS TO BE APPLIED. Addresses enter this app through exactly three
 * doors, and each one calls into here:
 *
 *   1. NextAuth's adapter -- what a provider claims, and what magic-link
 *      sign-in looks up. lib/authAdapter.ts.
 *   2. The magic-link sign-in form. lib/magicLink.ts's normalizeIdentifier.
 *   3. User-typed addresses in API request bodies. The zod fields below.
 *
 * Everything downstream reads addresses back out of the database, so once
 * those three are covered the rest of the app compares normalised against
 * normalised without having to know this file exists.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * A single user-supplied address in a request body: validated, then
 * normalised. Use this instead of `z.string().email()` anywhere the value
 * will be matched against a stored address -- which is everywhere, since an
 * address is only ever collected in order to look somebody up.
 *
 * `.trim()` runs before `.email()` so a pasted address with a trailing space
 * validates rather than being rejected as malformed; normalizeEmail trims
 * again afterwards, which is redundant here and deliberate, so the function
 * stands on its own for the callers that don't go through zod.
 */
export const emailField = z.string().trim().email().transform(normalizeEmail);

/**
 * A list of user-supplied addresses -- an event's invitees, a saved group's
 * membership. Normalises each, then drops duplicates.
 *
 * The de-duplication is not tidiness, it is required by normalisation. Two
 * spellings of one address arrive as two distinct strings, survive the
 * client's own "already added" check, and land here as one address twice.
 * That breaks lib/friends.ts's validateAllFriends, which compares the number
 * of rows it found against the number of addresses it was given, and it would
 * write the same person into a SavedGroup twice. Collapsing here means the
 * count callers see is the count of distinct people, which is what every
 * caller already assumes it is.
 *
 * min/max apply to the raw list, before collapsing: 50 is a ceiling on what
 * someone may submit, not on what survives.
 */
export const emailListField = z
  .array(emailField)
  .min(1)
  .max(50)
  .transform((emails) => Array.from(new Set(emails)));
