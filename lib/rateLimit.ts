import { prisma } from "./prisma";

const WINDOW_MS = 60_000; // 1 minute

/**
 * A database-backed rate limiter -- deliberately not in-memory, since
 * Vercel's serverless functions don't reliably share memory across
 * invocations (a naive in-memory counter would look like it works in
 * local dev, then silently do almost nothing once actually deployed,
 * since each request can land on a different, fresh instance).
 *
 * Uses one row per (route, subject) pair, not one row per individual hit --
 * this keeps the table's size proportional to your user count, not to
 * total request volume over time. A "log every hit" design would grow
 * forever and eventually slow down its own lookups, which is exactly the
 * kind of thing that wouldn't show up at small scale but would become a
 * real problem at large scale.
 *
 * `subject` is whatever the caller is limiting PER, not necessarily a user
 * id. Most callers pass one, but they never all did: magic-link sign-in
 * keys on the email address, since an unknown address is a legitimate
 * sign-up and there may be no user yet. The feedback form keys on a salted
 * hash of the caller's IP for the same reason. The parameter was named
 * `userId` while already carrying addresses, which read as though anonymous
 * callers were unsupported rather than merely rare -- the name is the only
 * thing that changed here.
 *
 * Returns true if the request should be ALLOWED, false if it should be
 * rejected (429).
 *
 * The read (does a row exist / is its window still current) and the write
 * (create it, reset it, or bump its count) happen in one statement, not as
 * a separate findUnique followed by an upsert/update. Splitting them left a
 * gap where concurrent callers could all read the same pre-increment count
 * before any of them wrote back, so a burst could clear a limit of 10 with
 * far more than 10 requests -- confirmed empirically under issue #12 (a
 * cold-start burst of 25 concurrent calls against a limit of 10 got all 25
 * through). Folding both into one `INSERT ... ON CONFLICT DO UPDATE`
 * closes that: Postgres takes a row lock for the conflicting update, so
 * concurrent callers serialize on it instead of racing.
 *
 * The `WHERE` on the DO UPDATE is what makes a rejection cost nothing to
 * store. Without it the statement still wrote on every call, so a caller
 * being actively throttled generated one row write per rejected request --
 * exactly backwards for a limiter, whose job under a flood is to shed load
 * more cheaply than the work it is protecting. A request that is already
 * over the cap now matches no row, so Postgres performs no write and
 * `RETURNING` yields nothing. That empty result IS the rejection, which is
 * why this returns on `rows.length` rather than comparing a count: the only
 * way to get a row back is to have been allowed. It also keeps `count`
 * bounded by `limit` instead of climbing for as long as a flood lasts.
 */
export async function checkRateLimit(routeKey: string, subject: string, limit: number): Promise<boolean> {
  const key = `${routeKey}:${subject}`;
  const now = new Date();
  const cutoff = new Date(now.getTime() - WINDOW_MS);

  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitState" AS r ("key", "windowStart", "count")
    VALUES (${key}, ${now}, 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN r."windowStart" < ${cutoff} THEN 1 ELSE r."count" + 1 END,
      "windowStart" = CASE WHEN r."windowStart" < ${cutoff} THEN ${now} ELSE r."windowStart" END
    WHERE r."windowStart" < ${cutoff} OR r."count" < ${limit}
    RETURNING "count"
  `;

  // Fire-and-forget: the sweep is unrelated to this request's answer, so
  // making the caller wait for it would add latency for no benefit. Errors
  // are swallowed deliberately -- a failed cleanup must never turn into a
  // failed friend request, and the next sweep will cover the same rows.
  if (Math.random() < SWEEP_PROBABILITY) {
    void sweepExpiredRateLimits().catch(() => {});
  }

  return rows.length > 0;
}

/**
 * How often a call also sweeps expired rows. Nothing else ever deleted from
 * this table, so it only grew: every row in it was expired when this was
 * added, the oldest by three weeks.
 *
 * A sweep is cheap because an expired row is provably meaningless -- the
 * limiter above treats "window expired" and "no row at all" identically, so
 * deleting one can never change a decision. That is what makes doing this
 * opportunistically, rather than under a scheduler, a safe trade: there is
 * no correctness cost to sweeping late, only a storage one.
 *
 * Rate rather than every call because the work is the same regardless of who
 * triggers it, and rare enough that it stays off the critical path of any
 * particular request. It also self-scales in the right direction: more
 * traffic means more sweeps, which is exactly when the table grows fastest.
 */
const SWEEP_PROBABILITY = 0.01;

/**
 * Deletes rows whose window has already expired.
 *
 * Bounds the table, but the reason it is not merely housekeeping is the
 * magic-link limiter: its subject is a plaintext email address, and sign-in
 * deliberately accepts addresses that are not users yet (an unknown address
 * is a legitimate sign-up). Without this, pointing the sign-in form at any
 * address on earth wrote that address into the database permanently, whether
 * or not its owner ever had anything to do with Venndra. Retention was
 * forever because nothing ever deleted anything.
 */
export async function sweepExpiredRateLimits(): Promise<number> {
  const cutoff = new Date(Date.now() - WINDOW_MS);
  return prisma.$executeRaw`DELETE FROM "RateLimitState" WHERE "windowStart" < ${cutoff}`;
}

/**
 * Forgets every limiter row belonging to the given subjects, whichever route
 * recorded them. Returned rather than awaited so the caller can compose it
 * into a transaction -- account deletion runs as one, and erasure that could
 * half-apply is worse than none.
 *
 * `subjects` is what was passed to checkRateLimit as the thing being limited
 * PER, so deleting an account means passing both its user id and its email
 * address: most routes key on the id, but magic-link keys on the address and
 * would otherwise outlive the account it belonged to.
 *
 * Matching is on everything after the FIRST colon, compared exactly, rather
 * than a LIKE against the whole key. Route keys never contain a colon so the
 * split is unambiguous, subjects sometimes do (`feedback` keys on
 * `anon:<hash>`) so only the first can be the separator, and an exact
 * comparison avoids an address containing `_` or `%` quietly matching its
 * neighbours the way a LIKE pattern would. An empty list matches nothing,
 * which is the right no-op.
 */
export function forgetRateLimitSubjects(subjects: string[]) {
  return prisma.$executeRaw`
    DELETE FROM "RateLimitState"
    WHERE substring("key" from position(':' in "key") + 1) = ANY(${subjects}::text[])
  `;
}
