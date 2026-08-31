import { defineConfig } from "vitest/config";

/**
 * Deliberately minimal, and deliberately not a full test suite -- see issue
 * #42. The scope is a small set of characterization tests over pure logic:
 * functions that take values and return values, with no database, no HTTP and
 * no React. Nothing here needs jsdom, and adding it would be the first step
 * toward the suite #29 decided not to build yet.
 *
 * `include` is narrowed to lib/ for that reason. It is a scope statement, not
 * a performance tweak: a test that needs to live outside lib/ is a signal the
 * scope is being widened, which is a decision to make on purpose rather than
 * by dropping a file into a new folder.
 */
export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",

    // Pinned, and deliberately NOT to UTC.
    //
    // Production runs UTC, so pinning tests to UTC would let server-timezone
    // dependence pass unnoticed -- which is exactly what happened: slot
    // building read the calendar day off the raw instant with server-local
    // getters, worked for every creator at or west of UTC, and returned
    // nothing at all for anyone east of it. Fixed 2026-08-31.
    //
    // Running the suite in a zone production never uses turns "does this
    // depend on where it runs" into something the tests answer. If that
    // dependence comes back, these go red rather than staying green until
    // somebody in Tokyo files a bug. Tokyo specifically because it is ahead of
    // UTC, which is the direction that was broken.
    env: { TZ: "Asia/Tokyo" },
  },
});
