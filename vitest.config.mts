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

  },
});
