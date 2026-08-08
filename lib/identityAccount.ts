import { prisma } from "./prisma";

/**
 * Which connected calendar represents the account this Venndra user IS -- the
 * one that can never be disconnected.
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
