import { fileURLToPath } from "node:url";
import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Turbopack (the default builder as of Next 16) infers the project root by
  // walking up for lockfiles, and there is a stray package-lock.json in the
  // home directory above this repo -- so it picked C:\Users\dckin and warned
  // that it was ignoring it. Pinning the root to this file's own directory
  // stops the inference, and stops an unrelated file outside the repo from
  // being able to move the build root.
  turbopack: {
    root: path.dirname(fileURLToPath(import.meta.url)),
  },

  experimental: {
    // Almost every page here is a server component reading per-user data
    // (friends, events, groups...) that can change from an action taken one
    // click ago (send a request, RSVP, save a filter). Next's client-side
    // Router Cache defaults to treating a dynamically-rendered page as fresh
    // for 30s after a soft navigation, which is exactly wrong for us --
    // that's the class of bug fixed one-off for app/events/new/page.tsx in
    // 530dc5f. Setting dynamic staleTime to 0 makes every soft navigation to
    // a dynamic route refetch, app-wide, instead of relying on individual
    // pages to opt out with `export const dynamic = "force-dynamic"`.
    staleTimes: {
      dynamic: 0,
    },
  },

  async redirects() {
    return [
      // Send the Vercel-assigned domain to the real one, so venndra.app is the
      // only host that ever serves the app in production.
      //
      // This isn't cosmetic. next-auth v4 derives its base URL from the
      // incoming request host whenever process.env.VERCEL is set -- see
      // detectOrigin in next-auth/utils/detect-origin.js, which ignores
      // NEXTAUTH_URL entirely on Vercel. So whichever hostname you arrive on
      // becomes the hostname in your magic links, your OAuth redirect_uri, and
      // the scope of your session cookie. Two reachable hosts therefore means
      // two parallel logged-in identities, and a permanent obligation to keep
      // *.vercel.app callback URLs registered with Google and Microsoft. One
      // host removes all of that.
      //
      // Matched on the exact vercel.app hostname rather than "any host that
      // isn't venndra.app". Preview deployments get their own unique
      // hostnames (venndra-git-<branch>-<team>.vercel.app), and a catch-all
      // would redirect every one of them to production -- which is precisely
      // why next-auth reads the request host in the first place. Naming the
      // one production alias leaves previews working.
      //
      // Deliberately NOT permanent: `permanent: true` emits a 308, which
      // browsers cache more or less forever, so undoing it wouldn't reach
      // anyone who had already been redirected once. 307 stays reversible.
      // Worth promoting to permanent later, once this has proven itself and
      // the SEO consolidation is worth the one-way door.
      {
        source: "/:path*",
        has: [{ type: "host", value: "venndra.vercel.app" }],
        destination: "https://venndra.app/:path*",
        permanent: false,
      },
    ];
  },
};
// Issue #38. The wrapper is what makes the instrumentation hooks actually
// run in a Next build -- Sentry.init in instrumentation.ts is necessary but on
// its own it is not sufficient, because the tunnel route and the server-side
// error hooks are injected here.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Source maps make a stack trace name our functions instead of Turbopack's
  // minified chunk symbols, and uploading them needs a write-scoped auth
  // token. Gated on that token existing rather than assumed: without it the
  // upload step fails the build, and the DSN is meant to be the only thing
  // anyone has to set to get this working.
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },

  // Routes browser events through /monitoring on our own domain. Ad blockers
  // block requests to *.ingest.sentry.io by default, and a fair share of
  // people run one -- without this we would silently see server errors only,
  // and would probably conclude the client SDK was broken.
  tunnelRoute: "/monitoring",

  // Build output stays readable. Deliberately no disableLogger: it is
  // deprecated in SDK 10 and, by its own warning, does nothing under
  // Turbopack -- which is the only builder Next 16 has.
  silent: !process.env.CI,
  telemetry: false,
});
