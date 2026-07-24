import { prisma } from "./prisma";

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