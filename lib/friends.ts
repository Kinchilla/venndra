import { prisma } from "./prisma";
import { pausedInviteeMessage } from "./pause";

/**
 * Confirms every email in `emails` (other than the given user's own)
 * belongs to an accepted friend of theirs. Returns an error message
 * string if not -- callers should respond with a 400 using that message.
 * Returns null when everything checks out.
 */
export async function validateAllFriends(userId: string, userEmail: string, emails: string[]): Promise<string | null> {
  const others = emails.filter((e) => e !== userEmail);
  if (others.length === 0) return null;

  const users = await prisma.user.findMany({ where: { email: { in: others } }, select: { id: true, email: true } });
  if (users.length !== others.length) {
    return "You can only invite people you're friends with on Venndra.";
  }

  const friendships = await prisma.friendship.findMany({
    where: {
      status: "ACCEPTED",
      OR: [
        { requesterId: userId, addresseeId: { in: users.map((u) => u.id) } },
        { addresseeId: userId, requesterId: { in: users.map((u) => u.id) } },
      ],
    },
  });
  const friendIds = new Set(friendships.flatMap((f) => [f.requesterId, f.addresseeId]));
  const allFriends = users.every((u) => friendIds.has(u.id));

  return allFriends ? null : "You can only invite people you're friends with on Venndra.";
}

/**
 * Confirms nobody in `emails` (other than the caller themselves) has paused
 * their account. Same contract as validateAllFriends above: a message string
 * to hand back as a 400, or null when everything checks out.
 *
 * Called from app/api/events only -- NOT from the saved-group routes, which
 * run validateAllFriends on the whole membership list every time a group is
 * saved. Enforcing pausing there too would mean someone pausing could block
 * their friends from renaming a group that happens to contain them, which
 * punishes the wrong person for a setting that's supposed to be quiet. A
 * group is only a list of addresses anyway; the event it seeds is where the
 * rule actually has to hold, and that's checked at creation regardless of
 * how the list was assembled. FriendPicker greys paused people out in both
 * places, so building a group around one isn't something the UI invites.
 *
 * The caller's own address is skipped for the same reason the friend check
 * skips it: pausing is about other people adding YOU, and it was never meant
 * to stop someone organizing their own plans while they're paused.
 */
export async function validateNoPausedInvitees(userEmail: string, emails: string[]): Promise<string | null> {
  const others = emails.filter((e) => e !== userEmail);
  if (others.length === 0) return null;

  const paused = await prisma.user.findMany({
    where: { email: { in: others }, pausedAt: { not: null } },
    select: { name: true, email: true },
  });
  if (paused.length === 0) return null;

  return pausedInviteeMessage(paused.map((u) => u.name ?? u.email ?? "Someone"));
}