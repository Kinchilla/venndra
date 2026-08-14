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
 */
export async function checkRateLimit(routeKey: string, subject: string, limit: number): Promise<boolean> {
  const key = `${routeKey}:${subject}`;
  const now = new Date();

  const existing = await prisma.rateLimitState.findUnique({ where: { key } });

  if (!existing || now.getTime() - existing.windowStart.getTime() > WINDOW_MS) {
    // No record yet, or the previous window has expired -- start fresh.
    await prisma.rateLimitState.upsert({
      where: { key },
      create: { key, windowStart: now, count: 1 },
      update: { windowStart: now, count: 1 },
    });
    return true;
  }

  if (existing.count >= limit) {
    return false; // still within the current window, already at the cap
  }

  await prisma.rateLimitState.update({ where: { key }, data: { count: { increment: 1 } } });
  return true;
}