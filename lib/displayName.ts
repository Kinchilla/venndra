/**
 * The one answer to "what do we call this person on screen?"
 *
 * Every people-list in the app -- friend chips, suggested friends, an event's
 * invited list, the results table, the reassign picker -- renders exactly this
 * string and nothing beside it. That "and nothing beside it" is the whole
 * point, and it is issue #6: the lists used to show a name AND the email under
 * it, which quietly turned the friends page into an address book. Suggested
 * Friends offers you friends-of-friends you have never met, so accepting one
 * taught you an address its owner never chose to give you.
 *
 * The fallback order is name, then email, then a placeholder -- and the email
 * step is deliberate rather than a leftover. Venndra does not force a display
 * name on anyone (issue #18): an account with no name is told, in
 * components/DisplayNameBanner, that its email address is what other people
 * will see until it sets one. So an email reaching a friend's screen through
 * this function is a choice its owner was informed of and declined to change,
 * which is a different thing entirely from the app volunteering it.
 *
 * Names are not unique and this does not make them so. Two friends who pick
 * the same one, or one person with separate work and personal accounts, still
 * render identically -- #6 weighed a masked email and an optional handle
 * against that and chose to accept the collision rather than keep a weaker
 * version of the same leak open.
 */

/** What someone with no name and no email is called. Should be unreachable. */
const ANONYMOUS = "Someone";

/**
 * Has this account got a display name of its own?
 *
 * Whitespace does not count. `User.name` is nullable and set from whatever the
 * OAuth provider returned, so "" and "   " are both reachable, and either one
 * would pass a bare null check while being no more use to a reader than null
 * was -- and would suppress the banner that exists to explain the situation.
 */
export function hasDisplayName(name: string | null | undefined): boolean {
  return typeof name === "string" && name.trim().length > 0;
}

/**
 * What to render for this person. Takes the whole user-ish object rather than
 * two arguments so call sites can't accidentally pass them in the wrong order
 * -- both are strings, and a swap would silently show the address instead.
 */
export function displayName(
  user: { name?: string | null; email?: string | null } | null | undefined
): string {
  if (hasDisplayName(user?.name)) return user!.name!.trim();
  return user?.email?.trim() || ANONYMOUS;
}
