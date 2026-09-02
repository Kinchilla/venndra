import { getServerSession, type Session } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "./auth";

/**
 * Reading the signed-in user on the server, in one place (#30).
 *
 * Forty-eight files opened with the same two lines -- getServerSession, then a
 * guard -- and every one of them then reached through `session.user` for an id
 * or an address. `session` was never used for anything else anywhere in the
 * app; it was a wrapper being unwrapped forty-eight times.
 *
 * WHAT THIS ACTUALLY FIXES, beyond saying it once. TypeScript narrows
 * `session.user` from the guard, but loses that narrowing inside a callback,
 * because it cannot prove `session` was not reassigned in between. So six call
 * sites wrote `session.user!.email` -- an unchecked assertion, in code that had
 * genuinely already checked. Binding the user to a `const` instead keeps the
 * narrowing through closures, and all six assertions become ordinary
 * compiler-verified reads. Same argument as the `as any` casts in 0ff08a6: an
 * assertion switches checking off rather than satisfying it, and these were
 * load-bearing on a value that can really be null.
 *
 * NOT a route wrapper. The obvious next step is a withUser() higher-order
 * function that removes the guard line entirely, and it was deliberately not
 * taken: it changes what every route file exports, which is what Next's own
 * generated types check against, and the payoff over this is one line per
 * route. Small and verifiable beat clever here -- the whole of #30's guidance,
 * and this touches more files than anything else in the sweep.
 */

/** The session's user, or null if nobody is signed in. */
export type SessionUser = NonNullable<Session["user"]>;

export async function currentUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  return session?.user ?? null;
}

/**
 * The 401 every API route answers an unauthenticated request with.
 *
 * Thirty-eight copies of one object literal. Nothing forced them to agree, and
 * the client reads `error` off it by name (lib/apiError) -- so a route that
 * one day said `message` instead would have shown its fallback text with
 * nothing to indicate the session had ended.
 */
export function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
