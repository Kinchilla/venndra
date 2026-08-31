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

    // Pinned to UTC because some of the code under test is sensitive to the
    // SERVER's timezone, not just the user's -- lib/availabilitySlots decides
    // which day's filter windows apply using `startOfDay` and `getDay()`,
    // which are local-time operations. Vercel runs UTC, so this makes a local
    // run and a CI run agree with production rather than with whoever's laptop
    // is running them. Without it these tests pass in Denver and fail in CI.
    //
    // It is a test-environment decision, not a fix: the underlying
    // timezone-sensitivity is real and is flagged on #42 for #30 to look at.
    env: { TZ: "UTC" },
  },
});
