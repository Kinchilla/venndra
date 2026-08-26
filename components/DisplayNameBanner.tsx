import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { hasDisplayName } from "../lib/displayName";
import { buttonClass } from "../lib/buttonStyles";

/**
 * Shown to a signed-in user with no display name. Renders nothing at all
 * otherwise, so pages can drop it in unconditionally.
 *
 * Reachable only by accounts that no identity provider ever supplied a name
 * for -- in practice, magic-link accounts with no Google or Microsoft account
 * linked. Every other route into Venndra brings a name along, and the sign-in
 * event in lib/auth.ts now backfills one the first time an OAuth account is
 * used, so an account seeing this has genuinely never had a name available.
 *
 * The wording is the point, and it is issue #18. Venndra's people-lists show
 * one identity string per person and nothing beside it (see
 * lib/displayName.ts), and for an account with no name that string is the
 * email address. Two ways to handle that:
 *
 *   Force a display name before the app opens. Rejected -- it makes a
 *   privacy judgement on someone else's behalf, and a mandatory name field
 *   invites exactly the wrong inference about why it's being asked for. Some
 *   people genuinely do not mind their friends seeing their address and
 *   should not be made to invent a name to get past a wall.
 *
 *   Say plainly what is being shown, and leave the choice open. That's this.
 *   The exposure is the same either way; what changes is whether the person
 *   knows about it, which is the entire difference between a leak and a
 *   preference.
 *
 * Deliberately not dismissable, for the same reason as
 * components/ConnectCalendarBanner: there is nothing to remember. It
 * disappears the moment a name is saved, and until then the thing it's saying
 * is still true. A dismissable version would decay into having told someone
 * once, months ago, about an exposure that is still ongoing -- which is not
 * meaningfully different from not having told them.
 */
export default async function DisplayNameBanner() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;

  // Read from the database rather than the session: the session is a snapshot
  // taken at sign-in, so someone who saves a name in Settings would keep
  // seeing this until their session was rebuilt.
  const user = await prisma.user.findUnique({
    where: { id: (session.user as any).id },
    select: { name: true, email: true },
  });
  if (!user || hasDisplayName(user.name)) return null;

  return (
    <div className="mt-6 rounded-xl border border-line bg-white px-4 py-3 sm:flex sm:items-center sm:justify-between sm:gap-4">
      <div>
        <p className="font-medium text-ink">Friends currently see your email address</p>
        <p className="mt-0.5 text-sm text-ink/60">
          You haven&apos;t set a display name, so <span className="text-ink/80">{user.email}</span> is what shows next to
          you on friend lists and events. Set a name and it replaces the address everywhere. It doesn&apos;t have to be
          your real one — it&apos;s only there so people can recognise you without needing your email.
        </p>
      </div>
      <Link
        href="/settings"
        className={buttonClass({ variant: "primary", className: "mt-3 inline-block shrink-0 sm:mt-0" })}
      >
        Set a display name
      </Link>
    </div>
  );
}
