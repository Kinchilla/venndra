import { PrismaAdapter } from "@next-auth/prisma-adapter";
import type { Adapter, AdapterSession } from "next-auth/adapters";
import { prisma } from "./prisma";

/**
 * The Prisma adapter, with one hole patched.
 *
 * @next-auth/prisma-adapter implements deleteSession as a bare
 * `session.delete({ where: { sessionToken } })`, and Prisma's delete THROWS
 * (P2025) when no row matches rather than treating it as a no-op. That turns
 * "the session is already gone" -- the exact state deleteSession is trying to
 * reach -- into a crash.
 *
 * Magic-link sign-in is what made this reachable. NextAuth's email branch in
 * core/lib/callback-handler.js does:
 *
 *     if (user?.id !== userByEmail.id && !useJwtSession && sessionToken)
 *       await deleteSession(sessionToken)
 *
 * `sessionToken` there is the raw cookie value, checked for truthiness only.
 * So a browser holding a cookie whose Session row no longer exists (the user
 * was deleted, the row was cleaned up after expiring, a dev database was
 * reset) satisfies the condition, hits the throw, and the whole sign-in fails
 * with an opaque `?error=Callback` -- on a fresh, valid magic link, with no
 * way for the user to tell what went wrong or to fix it short of clearing
 * cookies. The OAuth branches never call this, which is why nothing surfaced
 * it before.
 *
 * Swallowing P2025 here is safe for every caller, not just that one: sign-out
 * and the expired-session cleanup path both call deleteSession wanting the
 * row gone, and a missing row means they got their wish. It's also the
 * adapter's own house style -- it already does exactly this for
 * useVerificationToken, with the same reasoning about an already-consumed
 * row.
 */
export function prismaAdapterTolerantOfMissingSessions(): Adapter {
  const base = PrismaAdapter(prisma);

  return {
    ...base,
    // The return is annotated rather than inferred: Adapter types
    // deleteSession as a union whose arms return `Promise<void>` and
    // `Awaitable<AdapterSession | null | undefined>` respectively, and an
    // inferred `void | AdapterSession | null` matches neither. Narrowing to
    // the session-returning arm is accurate -- the Prisma adapter does return
    // the deleted row -- and callers in next-auth ignore the value anyway.
    async deleteSession(sessionToken: string): Promise<AdapterSession | null> {
      try {
        return ((await base.deleteSession!(sessionToken)) as AdapterSession | null | undefined) ?? null;
      } catch (error) {
        if (isRecordNotFound(error)) return null;
        throw error;
      }
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
