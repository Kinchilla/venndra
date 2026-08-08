import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import AzureADProvider from "next-auth/providers/azure-ad";
import { prisma } from "./prisma";
import { syncParticipantStatusForUser } from "./participants";
import { populateCalendarSources } from "./calendarSources";

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

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
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
    async signIn({ account }) {
      if (!account) return;
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
    // Reuses /login rather than a dedicated route. The one case this
    // currently handles is AccountNotLinkedError from the "connect another
    // account" flow (Settings) -- see the error-param handling in
    // app/login/page.tsx for how it distinguishes "still signed in, picked
    // an account that belongs to someone else" from a genuine first-time
    // sign-in collision.
    error: "/login",
  },
};
