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
    RETURNING "count"
  `;

  // A fresh row or a just-reset window always starts at count = 1, which is
  // <= any real limit, so this one comparison covers both the reset case
  // and the increment case -- no separate "no record yet" branch needed.
  return rows[0].count <= limit;
}