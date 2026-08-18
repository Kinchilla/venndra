import { prisma } from "../prisma";

/**
 * Tracks which connected calendars have a dead OAuth grant, so that "who is
 * broken right now?" is a single query rather than a hunt through Vercel
 * logs (which retain one hour on the current plan).
 *
 * Detection only, on purpose -- nothing here is shown to end users. See the
 * comment on ConnectedCalendar.authFailedAt in prisma/schema.prisma for why
 * the user-facing reconnect prompt waits until the Google app is verified.
 */

/**
 * Is this error the provider telling us the stored refresh token is dead --
 * expired or revoked -- so that only a fresh authorization will fix it?
 *
 * Deliberately narrow. Everything else a calendar read can fail with (rate
 * limits, 5xx, network blips, a calendar that was deleted) is transient or
 * calendar-specific, and flagging an account for one of those would report a
 * connection as broken when nothing is wrong with its credentials. The one
 * error that genuinely cannot be retried out of is `invalid_grant` from the
 * token endpoint.
 *
 * Google surfaces this through gaxios as response.data.error; the same
 * OAuth2 field name is what Microsoft returns from its token endpoint, so
 * the string check is the same for both. data can arrive parsed or raw
 * depending on how far the response got, hence both branches.
 */
export function isDeadGrantError(err: unknown): boolean {
  const data = (err as { response?: { data?: unknown } } | null)?.response?.data;
  if (typeof data === "string") return data.includes("invalid_grant");
  if (data && typeof data === "object") {
    return (data as { error?: unknown }).error === "invalid_grant";
  }
  return false;
}

/**
 * Marks every connected calendar backed by this NextAuth Account as having a
 * dead grant, recording WHEN it first broke.
 *
 * The `authFailedAt: null` in the where clause is doing two jobs: it keeps
 * the timestamp meaning "broken since" rather than "last seen broken", and
 * it means an account that is down costs one write total instead of one per
 * request -- a dead grant fails on every calendar read, of which there are
 * several per availability check.
 *
 * Never throws. This runs from inside catch blocks whose job is to report a
 * different error; a bookkeeping failure here must not replace it.
 */
export async function markAccountAuthFailed(nextAuthAccountId: string): Promise<void> {
  try {
    await prisma.connectedCalendar.updateMany({
      where: { nextAuthAccountId, authFailedAt: null },
      data: { authFailedAt: new Date() },
    });
  } catch (err) {
    console.error(`Failed to flag dead grant for account ${nextAuthAccountId}:`, err);
  }
}

/** Classify-and-record in one step, for the Google call sites. */
export async function noteDeadGrant(nextAuthAccountId: string, err: unknown): Promise<void> {
  if (isDeadGrantError(err)) await markAccountAuthFailed(nextAuthAccountId);
}

/**
 * Clears the flag after a successful re-authorization. Called from
 * events.signIn in lib/auth.ts, which is the only thing that can actually
 * fix a dead grant: a new refresh_token arrives solely from an
 * authorization-code exchange, never from a refresh. That is also why
 * nothing clears this on a merely successful calendar read -- if the grant
 * were dead, there would be no successful read to clear it from.
 *
 * Never throws, for the same reason as above: it runs inside a NextAuth
 * event, and a failure here must not break a sign-in that otherwise worked.
 */
export async function clearAccountAuthFailed(nextAuthAccountId: string): Promise<void> {
  try {
    await prisma.connectedCalendar.updateMany({
      where: { nextAuthAccountId },
      data: { authFailedAt: null },
    });
  } catch (err) {
    console.error(`Failed to clear dead-grant flag for account ${nextAuthAccountId}:`, err);
  }
}
