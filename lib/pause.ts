/**
 * What pausing an account means, and how it's worded.
 *
 * Pausing is the small, reversible half of Account management on /settings. It
 * does exactly one thing: nobody else can add the paused person to a NEW
 * event. Everything else about them carries on unchanged --
 *
 *   - events they're already on are untouched (leaving those is still a
 *     separate, manual choice, same as it ever was)
 *   - they stay visible in /friends and in the friend picker, greyed out
 *     rather than hidden, so the people who plan things with them can see
 *     what happened instead of watching them silently vanish
 *   - friendships, saved groups, and connected calendars are all left alone
 *   - they can still organize events themselves, and still put their own
 *     address on one -- the rule is about OTHER people adding THEM
 *
 * Deliberately prisma-free, for the same reason lib/buttonStyles.ts is
 * deliberately not "use client": the copy below is needed on both sides of
 * the wire (FriendPicker renders it inline, app/api/events rejects with it),
 * and a module that imports prisma can't be pulled into a client bundle. The
 * database half of the rule lives beside its sibling invite gate in
 * lib/friends.ts, which only ever gets imported by API routes.
 */

/** How a paused person is tagged wherever they still appear. */
export const PAUSED_TAG = "Paused";

/** "Ari", "Ari and Sam", "Ari, Sam and Jo" -- with a cap, so a bulk paste can't produce a paragraph. */
export function formatNameList(names: string[], max = 3): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];

  if (names.length > max) {
    const extra = names.length - max;
    return `${names.slice(0, max).join(", ")} and ${extra} other${extra === 1 ? "" : "s"}`;
  }

  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The one sentence explaining why these people can't be on a new event.
 *
 * Says "right now" on purpose: unpausing takes one click and needs no
 * approval from anyone, so the wording shouldn't imply the door is closed
 * for good. It stops short of suggesting the reader go ask them to unpause,
 * which would turn a private setting into something to be negotiated.
 */
export function pausedInviteeMessage(names: string[]): string {
  const verb = names.length === 1 ? "has" : "have";
  const account = names.length === 1 ? "account" : "accounts";
  return `${formatNameList(names)} ${verb} paused their Venndra ${account}, so they can't be added to a new event right now.`;
}
