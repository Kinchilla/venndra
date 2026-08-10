import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import AzureADProvider from "next-auth/providers/azure-ad";
import { prisma } from "./prisma";
import { syncParticipantStatusForUser } from "./participants";
import { populateCalendarSources } from "./calendarSources";
import { magicLinkProvider } from "./magicLink";
import { prismaAdapterTolerantOfMissingSessions } from "./authAdapter";

// Scopes we need in addition to basic sign-in:
// - Google: read calendar free/busy + create events on the primary calendar
// - Microsoft: read calendars + create events, via Graph
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

const MS_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "Calendars.ReadWrite",
].join(" ");

/**
 * How the three sign-in methods resolve to ONE Venndra user.
 *
 * Verified against next-auth 4.24.7's own core/lib/callback-handler.js rather
 * than assumed, because the two directions genuinely do not behave the same
 * and the docs read as though they might:
 *
 *   MAGIC LINK -> an account that already exists (however it was made).
 *   Works with no configuration. The `account.type === "email"` branch looks
 *   the address up with getUserByEmail and, if a user is found, signs them
 *   straight in and stamps emailVerified. It does not consult
 *   allowDangerousEmailAccountLinking, and it does not care that the existing
 *   user was created by Google or Microsoft. So someone who signed up with
 *   Google as dc.kinch@gmail.com can always get in by magic link to that same
 *   address, and lands in the same account, not a duplicate. This is safe for
 *   the obvious reason: receiving the link proves control of the mailbox.
 *
 *   Note it creates no Account row -- an email sign-in produces a Session and
 *   nothing more. That's why events.linkAccount never fires for it, and why
 *   events.signIn below has to skip it.
 *
 *   OAUTH -> an account that already exists under that address.
 *   Does NOT work by default: the `account.type === "oauth"` branch finds no
 *   Account for the provider, finds a User by email, and throws
 *   AccountNotLinkedError unless that provider sets
 *   allowDangerousEmailAccountLinking. NextAuth's check is per-provider and
 *   blunt -- it inspects neither side's emailVerified -- so turning it on
 *   means trusting that provider's email claim outright.
 *
 *   DELIBERATELY LEFT OFF, on both providers. Not an oversight and not a
 *   to-do -- don't switch it on to "fix" an OAuthAccountNotLinked report
 *   without re-reading this.
 *
 *   Off costs almost nothing, because this direction is still reachable
 *   without it: sign in by magic link, then use Connect another account in
 *   Settings. That path goes through the `if (user)` branch, which links to
 *   the signed-in user directly -- and after that one-time link, signing in
 *   with the provider works forever, because getUserByAccount now finds it.
 *   The flag would save one click, once, for one kind of user.
 *
 *   On would cost something real, and the risk is NOT the same as the risk
 *   magic link already carries. A magic link requires actually receiving mail
 *   at the address. This flag doesn't: it accepts whatever email a provider
 *   asserts. Microsoft documents Entra's `email` claim as unverified and
 *   admin-settable, and MICROSOFT_TENANT_ID defaults to "common" (any tenant),
 *   so with the flag on, someone who stood up their own tenant and set a
 *   user's mail attribute to a Venndra member's address would be handed that
 *   account -- connected calendars included -- having never had access to the
 *   mailbox. Google's claim is trustworthy, but the two are kept symmetric so
 *   there's one rule here instead of a per-provider exception to remember.
 *
 * Neither direction weakens the existing Settings guard. "That account is
 * already claimed by a different Venndra account" comes from a separate check
 * (userByAccount.id !== user.id) that runs before any email lookup.
 *
 * What magic link DOES change, unavoidably and by design: whoever controls a
 * Venndra user's mailbox can get into that Venndra account. Before this,
 * doing so meant getting through Google or Microsoft's login. This is
 * inherent to emailing people a credential, and the mitigations are in
 * lib/magicLink.ts -- 15-minute single-use links, and a send rate limit.
 */
export const authOptions: NextAuthOptions = {
  // Not PrismaAdapter(prisma) directly -- see authAdapter.ts for the one
  // behaviour that's overridden and why magic-link sign-in needs it.
  adapter: prismaAdapterTolerantOfMissingSessions(),
  session: { strategy: "database" },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: GOOGLE_SCOPES,
          access_type: "offline", // required to get a refresh_token
          prompt: "consent",      // forces refresh_token on every linking, not just the first
        },
      },
    }),
    AzureADProvider({
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
      tenantId: process.env.MICROSOFT_TENANT_ID ?? "common",
      authorization: { params: { scope: MS_SCOPES } },
    }),

    // Sign in with an email address and no OAuth at all. Unlike the two
    // above, this brings NO calendar with it -- it's purely a way to have an
    // account, which is what someone whose only calendar is iCloud needs,
    // since CalDAV is a calendar connection and not a sign-in method. Those
    // users land on a working account with nothing connected, which is what
    // lib/onboarding.ts and the Connect-a-calendar banner exist to handle.
    magicLinkProvider(),
  ],
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        (session.user as any).id = user.id;
        (session.user as any).timezone = (user as any).timezone;
      }
      return session;
    },
  },
  events: {
    // Whenever a Google or Microsoft account gets linked (first sign-in, or
    // "connect another calendar" later), automatically register it as an
    // availability source so the user doesn't have to do a separate step.
    async linkAccount({ user, account, profile }) {
      if (account.provider !== "google" && account.provider !== "azure-ad") return;

      const provider = account.provider === "google" ? "GOOGLE" : "MICROSOFT";
      const dbAccount = await prisma.account.findUnique({
        where: {
          provider_providerAccountId: {
            provider: account.provider,
            providerAccountId: account.providerAccountId,
          },
        },
      });
      if (!dbAccount) return;

      const already = await prisma.connectedCalendar.findFirst({
        where: { userId: user.id, nextAuthAccountId: dbAccount.id },
      });
      if (already) return;

      const connected = await prisma.connectedCalendar.create({
        data: {
          userId: user.id,
          provider,
          nextAuthAccountId: dbAccount.id,
          // Which provider account this calendar came from. Must come from
          // `profile` (the account that just authenticated), NOT user.email
          // -- once someone links a second Google/Microsoft account, the
          // owning user's email is the WRONG answer for the new calendar.
          // Left null if the provider returned no email (happens with some
          // Microsoft work/school accounts); the UI falls back to `label`.
          accountEmail: profile?.email ?? null,
          label: provider === "GOOGLE" ? "Google Calendar" : "Outlook Calendar",
        },
      });

      await populateCalendarSources(connected.id);

      if (user.email) await syncParticipantStatusForUser(user.id, user.email);
    },

    // linkAccount only fires the very FIRST time an account is ever
    // connected -- NextAuth's known behavior (see GitHub issue #3599) is
    // to never touch the stored tokens again on later sign-ins, even
    // though a fresh access_token/refresh_token comes back every time.
    // This handler runs on EVERY successful sign-in, first-time or not,
    // and explicitly re-saves whatever fresh tokens just came back --
    // otherwise a token quietly goes stale (e.g. Google's 7-day limit for
    // unverified apps) and re-signing-in never actually fixes it, since
    // nothing was ever writing the new one down.
    //
    // Restricted to OAuth accounts. This event fires for EVERY provider type,
    // and a magic-link sign-in supplies a synthetic account of
    // { type: "email", provider: "email", providerAccountId: <the address> }
    // that has no Account row behind it -- email sign-in creates a Session and
    // nothing else. Without this guard the update below matches nothing and
    // Prisma throws P2025, which NextAuth turns into a failed callback: every
    // magic-link sign-in would break at the last step, after the session
    // cookie was already set.
    async signIn({ account }) {
      if (account?.type !== "oauth") return;
      await prisma.account.update({
        where: {
          provider_providerAccountId: { provider: account.provider, providerAccountId: account.providerAccountId },
        },
        data: {
          // Passing `undefined` (rather than null) for any of these tells
          // Prisma "leave this field alone" -- important because Google
          // doesn't always send back a fresh refresh_token on every single
          // sign-in, and we don't want to accidentally wipe out a
          // perfectly good one with nothing.
          access_token: account.access_token ?? undefined,
          refresh_token: account.refresh_token ?? undefined,
          expires_at: account.expires_at ?? undefined,
          id_token: account.id_token ?? undefined,
          scope: account.scope ?? undefined,
          token_type: account.token_type ?? undefined,
        },
      });
    },
  },
  pages: {
    signIn: "/login",
    // Where NextAuth parks the browser after a magic link is sent. Without
    // this it renders its own unbranded built-in page.
    verifyRequest: "/login/check-email",
    // Reuses /login rather than a dedicated route. The one case this
    // currently handles is AccountNotLinkedError from the "connect another
    // account" flow (Settings) -- see the error-param handling in
    // app/login/page.tsx for how it distinguishes "still signed in, picked
    // an account that belongs to someone else" from a genuine first-time
    // sign-in collision.
    error: "/login",
  },
};
