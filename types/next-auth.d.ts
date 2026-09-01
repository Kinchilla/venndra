/**
 * What Venndra actually puts on the session, declared once (#30).
 *
 * NextAuth ships a deliberately minimal Session.user -- name, email, image --
 * because it can't know what any given app adds. The session callback in
 * lib/auth.ts adds two things to it: the User row's `id`, which is the key
 * almost every route and page looks work up by, and `timezone`, which the
 * new-event form uses to default the search timezone.
 *
 * Before this file, every one of those reads was written as
 * `(session.user as any).id` -- 53 of them across app/, components/ and
 * lib/auth.ts itself. Each cast is an independent, unchecked assertion about
 * the same object, which is the pattern #30 exists to remove: not repeated
 * code that is merely untidy, but one fact restated in 53 places with nothing
 * making the restatements agree. `as any` also switches off checking rather
 * than satisfying it, so a typo (`.userId`, `.tz`) compiled fine and arrived
 * as `undefined` at runtime.
 *
 * Module augmentation is the supported way to tell TypeScript what the
 * callback did. Types erase before the program runs (see
 * duplication-and-types-explained.md), so this file adds nothing to the
 * bundle and changes no behaviour -- it only makes the compiler agree with
 * what lib/auth.ts has been doing all along.
 *
 * `user` stays optional, matching DefaultSession: a Session can exist with no
 * user, which is why the `if (!session?.user)` guard at the top of every
 * route is real and not ceremony.
 */

import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user?: {
      /** User.id -- set by the session callback in lib/auth.ts. */
      id: string;
      /**
       * User.timezone. Non-null in the database (it carries a default), so
       * this is `string` rather than `string | null`.
       */
      timezone: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/adapters" {
  interface AdapterUser {
    /**
     * A Venndra column NextAuth's own AdapterUser doesn't know about. The
     * adapter returns whole User rows, so it is genuinely there; this is what
     * lets the session callback read it without a second cast.
     */
    timezone: string;
  }
}
