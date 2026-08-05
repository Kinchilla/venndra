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
};
export default nextConfig;
