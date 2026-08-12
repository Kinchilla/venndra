import { PrismaAdapter } from "@next-auth/prisma-adapter";
import type { Adapter, AdapterSession, VerificationToken } from "next-auth/adapters";
import { prisma } from "./prisma";

/**
 * The Prisma adapter, with two behaviours overridden.
 *
 *   deleteSession         -- swallows "no such row" instead of throwing.
 *   useVerificationToken  -- reads a magic-link token without consuming it, so
 *                            a link works for its whole 15-minute window
 *                            rather than exactly once.
 *
 * Both exist because of magic-link sign-in, and both are explained in full at
 * the method they patch. createVerificationToken is overridden only to clean
 * up after the second one.
 */
export function prismaAdapterWithMagicLinkFixes(): Adapter {
  const base = PrismaAdapter(prisma);

  return {
    ...base,

    /**
     * @next-auth/prisma-adapter implements deleteSession as a bare
     * `session.delete({ where: { sessionToken } })`, and Prisma's delete THROWS
     * (P2025) when no row matches rather than treating it as a no-op. That
     * turns "the session is already gone" -- the exact state deleteSession is
     * trying to reach -- into a crash.
     *
     * Magic-link sign-in is what made this reachable. NextAuth's email branch
     * in core/lib/callback-handler.js does:
     *
     *     if (user?.id !== userByEmail.id && !useJwtSession && sessionToken)
     *       await deleteSession(sessionToken)
     *
     * `sessionToken` there is the raw cookie value, checked for truthiness
     * only. So a browser holding a cookie whose Session row no longer exists
     * (the user was deleted, the row was cleaned up after expiring, a dev
     * database was reset) satisfies the condition, hits the throw, and the
     * whole sign-in fails with an opaque `?error=Callback` -- on a fresh, valid
     * magic link, with no way for the user to tell what went wrong or to fix it
     * short of clearing cookies. The OAuth branches never call this, which is
     * why nothing surfaced it before.
     *
     * Swallowing P2025 here is safe for every caller, not just that one:
     * sign-out and the expired-session cleanup path both call deleteSession
     * wanting the row gone, and a missing row means they got their wish.
     *
     * The return is annotated rather than inferred: Adapter types deleteSession
     * as a union whose arms return `Promise<void>` and `Awaitable<AdapterSession
     * | null | undefined>` respectively, and an inferred `void | AdapterSession
     * | null` matches neither. Narrowing to the session-returning arm is
     * accurate -- the Prisma adapter does return the deleted row -- and callers
     * in next-auth ignore the value anyway.
     */
    async deleteSession(sessionToken: string): Promise<AdapterSession | null> {
      try {
        return ((await base.deleteSession!(sessionToken)) as AdapterSession | null | undefined) ?? null;
      } catch (error) {
        if (isRecordNotFound(error)) return null;
        throw error;
      }
    },

    /**
     * Look the token up; do NOT delete it. The stock adapter deletes, which is
     * what makes a magic link single-use.
     *
     * Single-use sounds strictly safer than it is, because it hands the one use
     * to whoever GETs the URL first -- and that is often not the person who
     * asked for it. Two things do this routinely, and neither involves an
     * attacker: link scanners in a mail pipeline (Safe Links, Proofpoint, and
     * anything a forwarding address puts in the way) fetch every URL on
     * delivery, and mail apps open links in a throwaway in-app webview whose
     * cookie jar the user's real browser never sees. Either way the session is
     * created somewhere the user isn't, the token is gone, and their own click
     * lands on "That sign-in link has expired or was already used."
     *
     * The failure is unrecoverable rather than annoying, which is the part that
     * matters: requesting a fresh link changes nothing, because the new link
     * meets the same scanner or the same webview. Someone whose only sign-in
     * method is a magic link -- the iCloud-only user this provider exists for,
     * per lib/magicLink.ts -- is then locked out of Venndra permanently, with
     * every message in the UI telling them to try again.
     *
     * Reading without deleting fixes exactly that: the scanner's fetch still
     * strands a session it will never use (unchanged, and harmless), and the
     * user's own click afterwards now works.
     *
     * Expiry is untouched and still enforced -- just not here. NextAuth's
     * callback route rejects `invite.expires.valueOf() < Date.now()` on the row
     * this returns, so the 15 minutes set in lib/magicLink.ts remains the real
     * limit, and an expired row is as dead as a missing one.
     *
     * What's given up: inside that window a link is a bearer credential usable
     * more than once instead of once. That is a smaller change than it reads
     * as. Anyone positioned to replay the link already has the mailbox, which
     * is the access magic links inherently trust -- so replay buys an attacker
     * nothing they couldn't get by requesting a link of their own. The real
     * loss is the ability to *detect* a second use, which nothing acted on
     * anyway. Weigh that against locking people out for good, which is the
     * failure this replaces.
     */
    async useVerificationToken(params: { identifier: string; token: string }): Promise<VerificationToken | null> {
      return prisma.verificationToken.findUnique({
        where: { identifier_token: { identifier: params.identifier, token: params.token } },
      });
    },

    /**
     * Sweep this address's expired tokens, then create the new one.
     *
     * Needed only because useVerificationToken above stopped deleting. Nothing
     * else in the app touches this table and Postgres has no TTL, so without a
     * sweep every link ever issued would sit there forever.
     *
     * Doing it on create rather than on a timer keeps it to one address's rows
     * at the moment that address is provably active. What survives is at most
     * one stale row per address that asked for a link and never came back,
     * which is a bounded and uninteresting amount of junk.
     *
     * Scoped to the identifier deliberately: it's the leading column of the
     * [identifier, token] unique index, so this is an index range delete. A
     * global sweep on `expires` -- which is indexed by nothing -- would table
     * scan on every single sign-in request.
     */
    async createVerificationToken(token: VerificationToken): Promise<VerificationToken> {
      await prisma.verificationToken.deleteMany({
        where: { identifier: token.identifier, expires: { lt: new Date() } },
      });
      return prisma.verificationToken.create({ data: token });
    },
  };
}

/**
 * Matches on the code rather than `instanceof PrismaClientKnownRequestError`.
 * The generated client is imported through several paths in a Next.js build
 * (server components, route handlers, the edge-ish runtimes), and an
 * instanceof against a class from a different module instance silently
 * returns false -- which would put the throw back without any visible change
 * to this file.
 */
function isRecordNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2025";
}
