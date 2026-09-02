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
 * Thrown by a provider client that has positively identified a dead grant from
 * the token endpoint's own error code, for the benefit of catch blocks further
 * out that can only see an Error.
 *
 * Exists because the two providers fail at different depths. Google's refresh
 * happens lazily inside the per-calendar read, so its dead grant is caught and
 * classified within lib/calendar/google.ts. Microsoft's happens up front in
 * getValidAccessToken, before the per-calendar loop, so it escapes the whole
 * provider module and lands in lib/availability.ts -- which has no provider
 * detail left to classify by. This type is what survives that trip.
 */
export class DeadGrantError extends Error {}

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
 * Google surfaces this through gaxios as response.data.error, which is the
 * shape the two branches below read -- parsed or raw depending on how far the
 * response got.
 *
 * Microsoft returns the same OAuth2 error name, but reaches us without gaxios:
 * lib/calendar/microsoft.ts refreshes with a bare fetch, so there is no
 * `response.data` to inspect and the only trace of the error code would be
 * inside the message string it throws. Rather than have this function go
 * fishing in message text -- which would match any error that merely mentions
 * the phrase -- that call site throws DeadGrantError, since it has already
 * read `tokens.error` and knows the answer for certain.
 */
export function isDeadGrantError(err: unknown): boolean {
  if (err instanceof DeadGrantError) return true;

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
 * Logs a failed calendar read at a level that reflects whether anyone can act
 * on it.
 *
 * A dead grant is not an application error. It is an expected user state --
 * the person revoked access, or their refresh token expired -- it is already
 * recorded durably on ConnectedCalendar.authFailedAt by the time this runs,
 * and no change to this code can fix it; only a reconnect can. Reporting it
 * through console.error meant Sentry raised an Issue for each one, because
 * captureConsoleIntegration promotes every console.error site in the app (see
 * lib/sentryOptions.ts). That fired once per calendar per availability check,
 * for as long as the account stayed broken, against a free-tier event quota --
 * two such Issues on 2026-09-01 were what prompted this. warn keeps the line
 * in the Vercel logs for anyone reading them and keeps it out of Sentry.
 *
 * Everything else -- rate limits, 5xx, a calendar deleted mid-read -- stays an
 * error, because those are the ones worth being told about.
 *
 * Note the asymmetry with isDeadGrantError's other caller: noteDeadGrant
 * writing the flag is what makes dropping the report safe here, so the two
 * belong at the same call sites. A site that quiets the log without recording
 * the breakage would leave it invisible in both places.
 */
export function logCalendarFailure(message: string, err: unknown): void {
  if (isDeadGrantError(err)) console.warn(message, err);
  else console.error(message, err);
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
