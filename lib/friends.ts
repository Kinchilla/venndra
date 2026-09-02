import { prisma } from "./prisma";
import { displayName } from "./displayName";
import { pausedInviteeMessage } from "./pause";

/**
 * Confirms every email in `emails` (other than the given user's own)
 * belongs to an accepted friend of theirs. Returns an error message
 * string if not -- callers should respond with a 400 using that message.
 * Returns null when everything checks out.
 */
export async function validateAllFriends(userId: string, userEmail: string, emails: string[]): Promise<string | null> {
  // De-duplicated before the count below is taken. `users.length !==
  // others.length` is the check that "every address resolved to a user", and
  // it only means that if each address appears once -- one address listed
  // twice makes two entries and one row, and the caller gets told they aren't
  // friends with someone they are. The routes pass emailListField output,
  // which is already distinct; this holds the invariant here too, since it's
  // this function's arithmetic that depends on it.
  const others = Array.from(new Set(emails)).filter((e) => e !== userEmail);
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

  // Through displayName like every other people-list: this message names
  // people back to the organizer, and naming them by address would reintroduce
  // issue #6's leak in a sentence rather than in a chip.
  return pausedInviteeMessage(paused.map(displayName));
}
/**
 * Everything the friends UI needs about one relationship: who, and which row
 * to act on.
 *
 * `friendshipId` is the Friendship row, not the user -- it is what
 * FriendChip's accept/decline/remove buttons put in their URLs, which is why
 * it is named for the row rather than being a bare `id` that reads like it
 * belongs to the person.
 */
export type FriendListEntry = {
  friendshipId: string;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
    /**
     * Whether they are paused, never since when. The flag is what greys them
     * out in the picker; the timestamp behind it is the paused person's own
     * business, and nothing on this side of the app could do anything useful
     * with it.
     */
    paused: boolean;
  };
};

const FRIEND_USER_SELECT = { id: true, name: true, email: true, image: true, pausedAt: true };

function toFriendUser<T extends { pausedAt: Date | null }>({ pausedAt, ...user }: T) {
  return { ...user, paused: pausedAt !== null };
}

/**
 * The signed-in user's friends, split the three ways the UI shows them (#30).
 *
 * GET /api/friends and app/friends/page.tsx both answered this, with the same
 * two queries, the same select, the same pausedAt-to-flag mapping and the same
 * three-way partition written out twice. The shape was additionally described
 * a third time, structurally, by the page's FriendSection props.
 *
 * The only thing that actually differed was a key name -- the route called it
 * `friendshipId`, the page called it `id` -- so this returns `friendshipId`,
 * which leaves the route's wire format byte-identical and renames only the
 * page's own local. Nothing reads the route's `friendshipId` today
 * (FriendPicker takes `.user` and ignores the rest), so the name was chosen
 * for the reader rather than for compatibility, but not changing a published
 * field is free and worth having.
 *
 * A friendship is directional in the database -- requester and addressee --
 * and not directional to a person looking at their friends list. Collapsing
 * the two directions is most of what this function is for, and doing it in one
 * place is what stops "sent" and "received" drifting apart between the two
 * callers.
 */
export async function loadFriendLists(userId: string): Promise<{
  friends: FriendListEntry[];
  pendingSent: FriendListEntry[];
  pendingReceived: FriendListEntry[];
}> {
  const [sent, received] = await Promise.all([
    prisma.friendship.findMany({
      where: { requesterId: userId },
      include: { addressee: { select: FRIEND_USER_SELECT } },
    }),
    prisma.friendship.findMany({
      where: { addresseeId: userId },
      include: { requester: { select: FRIEND_USER_SELECT } },
    }),
  ]);

  return {
    friends: [
      ...sent
        .filter((f) => f.status === "ACCEPTED")
        .map((f) => ({ friendshipId: f.id, user: toFriendUser(f.addressee) })),
      ...received
        .filter((f) => f.status === "ACCEPTED")
        .map((f) => ({ friendshipId: f.id, user: toFriendUser(f.requester) })),
    ],
    pendingSent: sent
      .filter((f) => f.status === "PENDING")
      .map((f) => ({ friendshipId: f.id, user: toFriendUser(f.addressee) })),
    pendingReceived: received
      .filter((f) => f.status === "PENDING")
      .map((f) => ({ friendshipId: f.id, user: toFriendUser(f.requester) })),
  };
}
