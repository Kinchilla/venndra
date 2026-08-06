import { prisma } from "./prisma";

/**
 * Whenever a user connects a calendar (Google/Microsoft sign-in, or Apple
 * via CalDAV), retroactively mark them CONNECTED on any events where
 * they're already a participant but still show INVITED.
 *
 * In the normal case this should rarely have anything to do: an account
 * can only be created via Google/Microsoft OAuth (see lib/auth.ts's
 * providers), and linkAccount auto-attaches an isEnabled ConnectedCalendar
 * the moment that account is first created -- there's no way to disable or
 * disconnect one afterwards. Since an email must already belong to an
 * account to be invited at all (lib/friends.ts's validateAllFriends), a
 * participant with an account has almost always already got a calendar by
 * the time anyone could invite them.
 *
 * The gap this covers: linkAccount's calendar auto-attach can silently
 * no-op (see the `if (!dbAccount) return` guard in lib/auth.ts), leaving a
 * real signed-in user with zero connected calendars and no other path back
 * to CONNECTED. This function, called from lib/auth.ts's linkAccount and
 * from app/api/calendars/apple/route.ts, and its manual-refresh
 * counterpart app/api/events/[id]/join/route.ts (the JoinPrompt "Already
 * connected? Refresh" button) are what let that account recover -- edge
 * case, not dead code.
 */
export async function syncParticipantStatusForUser(userId: string, email: string) {
  await prisma.eventParticipant.updateMany({
    where: { email, status: "INVITED" },
    data: { userId, status: "CONNECTED" },
  });
}
