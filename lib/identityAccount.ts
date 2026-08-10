import { prisma } from "./prisma";

/**
 * CURRENTLY UNUSED, AND KEPT ON PURPOSE. Not dead code to tidy away.
 *
 * This backed the old rule that the OAuth account a user signed up with could
 * never be disconnected. Magic-link sign-in retired that rule: an email
 * address is itself a way back in, so no OAuth account is load-bearing for
 * sign-in any more, and both callers (the GET and DELETE handlers under
 * app/api/calendars/accounts) now gate on `!user?.email` instead.
 *
 * It stays because that decision is reversible -- if locking the identity
 * account back down turns out to be the right call, this is the piece that
 * would be needed again, and its reasoning below is the expensive part to
 * reconstruct. Delete it once the looser rule has been in place long enough
 * to be settled.
 *
 * ---
 *
 * Which connected calendar represents the account this Venndra user IS.
 *
 * Identified by email AND recency, not email alone. Matching on email alone
 * looked right until someone linked a Microsoft account using the same address
 * as their Google one: both rows matched User.email, so BOTH were exempt, and a
 * second account became undisconnectable purely for sharing an address. Taking
 * the oldest is what makes it exactly one.
 *
 * Oldest is also the correct one on the merits. User.email is written at signup
 * from the first provider's profile and never changes afterwards, so the
 * earliest OAuth calendar bearing that address is by construction the account
 * the Venndra identity was created from. Anything linked later is an addition,
 * however similar its address looks.
 *
 * Returns null when the user has no email, or when no linked calendar carries
 * it (accountEmail is nullable -- some Microsoft work accounts return no email
 * claim). Callers must not treat null as "nothing is protected": the routes
 * keep a separate last-remaining-credential guard for exactly that case.
 */
export async function findIdentityCalendarId(userId: string, userEmail: string | null): Promise<string | null> {
  if (!userEmail) return null;

  const identity = await prisma.connectedCalendar.findFirst({
    where: { userId, nextAuthAccountId: { not: null }, accountEmail: userEmail },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  return identity?.id ?? null;
}
