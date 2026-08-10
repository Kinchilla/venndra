import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "../lib/auth";
import { hasUsableCalendar } from "../lib/onboarding";
import { buttonClass } from "../lib/buttonStyles";

/**
 * Shown to a signed-in user with no enabled calendar. Renders nothing at all
 * otherwise, so pages can drop it in unconditionally.
 *
 * Reachable mainly by magic-link accounts, which are the first kind that can
 * exist without a calendar attached (see lib/onboarding.ts). Nothing in
 * Venndra computes anything without one, so this is less a suggestion than an
 * explanation of why the rest of the app is going to look empty.
 *
 * A banner and not a redirect: /events, /friends and /groups all still do
 * something useful with no calendar connected (you can be invited to things,
 * accept friend requests, build a group), so trapping people on /settings
 * would take away pages that work. The one place that genuinely cannot work
 * is creating a search, and that one redirects -- see app/events/new/page.tsx.
 *
 * Deliberately not dismissable. There's nothing to remember: it disappears
 * the moment a calendar is connected, and until then the thing it's saying is
 * still true.
 */
export default async function ConnectCalendarBanner() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;

  const userId = (session.user as any).id;
  if (await hasUsableCalendar(userId)) return null;

  return (
    <div className="mt-6 rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 sm:flex sm:items-center sm:justify-between sm:gap-4">
      <div>
        <p className="font-medium text-ink">Connect a calendar to get started</p>
        <p className="mt-0.5 text-sm text-ink/60">
          Venndra finds times by comparing everyone&apos;s busy hours, so it can&apos;t do much until it can see yours.
          Google, Outlook and iCloud all work.
        </p>
      </div>
      <Link href="/settings" className={buttonClass({ variant: "primary", className: "mt-3 inline-block shrink-0 sm:mt-0" })}>
        Connect a calendar
      </Link>
    </div>
  );
}
