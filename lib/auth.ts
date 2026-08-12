import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import AzureADProvider from "next-auth/providers/azure-ad";
import { prisma } from "./prisma";
import { syncParticipantStatusForUser } from "./participants";
import { populateCalendarSources } from "./calendarSources";
import { magicLinkProvider } from "./magicLink";
import { prismaAdapterWithMagicLinkFixes } from "./authAdapter";

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
 *   ON for Google. OFF for Microsoft. The asymmetry is the point, and it is
 *   about how much each provider's email claim is worth, not about how much
 *   we like each provider.
 *
 *   Google is on because asserting an address there means controlling it.
 *   gmail.com is Google's own namespace; a Workspace domain has to pass DNS
 *   verification before its admin can mint anything in it, and even then only
 *   within that domain; a Google Account on an outside address is
 *   email-verified at creation. So the claim is worth about what receiving
 *   mail at the address is worth -- which is exactly the trust magic-link
 *   sign-in already extends, one section up. Turning it on adds no new class
 *   of access.
 *
 *   Microsoft is off because its claim is worth much less. Entra's `email` is
 *   documented as unverified and admin-settable, and MICROSOFT_TENANT_ID
 *   defaults to "common" (any tenant), so with the flag on, someone who stood
 *   up their own tenant and set a user's mail attribute to a Venndra member's
 *   address would be handed that account -- connected calendars included --
 *   having never had access to the mailbox. That is a real takeover path and
 *   it stays shut.
 *
 *   These two were once kept symmetric on the theory that one rule is easier
 *   to remember than a per-provider exception. That symmetry was arbitrary --
 *   it took the weaker provider's risk and charged it to the safer one -- and
 *   it had a running cost, paid by users rather than by whoever reads this
 *   file. Off, a Google user whose account was created some other way hits
 *   "an account already exists for that email address" and has exactly one way
 *   out: sign in by magic link, then Connect another account in Settings. That
 *   works right up until the magic link is the thing that's failing, and then
 *   the two sign-in methods deadlock and the person is simply locked out.
 *   Being able to fall back on either method when the other misbehaves is
 *   worth more than the tidiness of one rule.
 *
 *   What this does NOT do is make a second account under the same address. It
 *   links the Google account to the existing user, which is the same end state
 *   as Connect another account in Settings, reached without the round trip.
 *
 * The next thought after reading the above -- "fine, then let the provider
 * make a SECOND account instead of erroring" -- is also deliberately not
 * supported, and is a much bigger change than it sounds. It presents as a
 * sign-in feature and is really a schema change: User.email is @unique
 * (prisma/schema.prisma) because email is this app's identity key for people
 * who don't have accounts yet. EventParticipant stores bare address strings,
 * so a second user sharing an address makes several lookups ambiguous at once.
 * lib/friends.ts's validateAllFriends resolves invitees with a findMany on
 * email and would get a set where it expects one user. Worse,
 * lib/participants.ts's syncParticipantStatusForUser updateManys on email
 * alone, so whichever of the two accounts connected a calendar most recently
 * would silently claim EVERY invitation sent to that address, including ones
 * meant for the other. And magic link's getUserByEmail returns one row of two,
 * non-deterministically. Supporting this means re-keying invitations off email
 * first; the login flow is the cheap part.
 *
 * So two Venndra accounts need two addresses -- which already works today with
 * no code at all, since a provider account whose address matches no existing
 * user takes callback-handler's createUser branch and gets an independent
 * account. The uniqueness of email isn't obstinacy: it's what makes "invite
 * this address" have exactly one answer.
 *
 * Neither direction weakens the existing Settings guard. "That account is
 * already claimed by a different Venndra account" comes from a separate check
 * (userByAccount.id !== user.id) that runs before any email lookup.
 *
 * What magic link DOES change, unavoidably and by design: whoever controls a
 * Venndra user's mailbox can get into that Venndra account. Before this,
 * doing so meant getting through Google or Microsoft's login. This is
 * inherent to emailing people a credential, and the mitigations are in
 * lib/magicLink.ts -- a 15-minute expiry, and a send rate limit. Not
 * single use: a link works for its whole window, for the reasons set out at
 * useVerificationToken in authAdapter.ts.
 */
export const authOptions: NextAuthOptions = {
  // Not PrismaAdapter(prisma) directly -- see authAdapter.ts for the two
  // behaviours that are overridden and why magic-link sign-in needs them.
  adapter: prismaAdapterWithMagicLinkFixes(),
  session: { strategy: "database" },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // Google only, and not Microsoft -- the long comment above is the whole
      // argument for why the two differ. Read it before changing either.
      allowDangerousEmailAccountLinking: true,
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
