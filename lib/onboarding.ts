import { prisma } from "./prisma";

/**
 * Does this user have anything Venndra can actually read availability from?
 *
 * Only meaningfully false for accounts created by magic link, which is the
 * first sign-in method that doesn't bring a calendar along with it -- a Google
 * or Microsoft sign-in registers its calendar automatically in
 * events.linkAccount, so those users have never been able to reach the app
 * with nothing connected.
 *
 * Counts ENABLED calendars, not connected ones. A user who has turned every
 * calendar off is in exactly the same position as one who has none: no busy
 * times can be read, so every slot search is meaningless. Treating those two
 * states differently would show the "connect a calendar" nudge to one and not
 * the other while both are equally stuck.
 */
export async function hasUsableCalendar(userId: string): Promise<boolean> {
  const count = await prisma.connectedCalendar.count({ where: { userId, isEnabled: true } });
  return count > 0;
}
