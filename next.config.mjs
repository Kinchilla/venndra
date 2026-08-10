/** @type {import('next').NextConfig} */
const nextConfig = {
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
export default nextConfig;
