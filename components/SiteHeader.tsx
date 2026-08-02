import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "../lib/auth";
import { prisma } from "../lib/prisma";
import Logo from "./Logo";

export default async function SiteHeader() {
  const session = await getServerSession(authOptions);
  const userId = session?.user ? (session.user as any).id : null;

  const incomingCount = userId
    ? await prisma.friendship.count({ where: { addresseeId: userId, status: "PENDING" } })
    : 0;

  return (
    <header className="border-b border-line/60 bg-paper/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <Link href="/" aria-label="Venndra — home" className="inline-flex items-baseline">
          <span className="font-display text-lg font-semibold">Ve</span>
          <Logo height={9.5} className="relative top-[0.5px]" />
          <span className="font-display text-lg font-semibold">dra</span>
        </Link>

        <div className="flex items-center gap-1">
          {session?.user && (
            <>
              <NavDropdown
                label="Events"
                href="/events"
                items={[
                  { label: "New event", href: "/events/new" },
                  { label: "Existing events", href: "/events" },
                ]}
              />
              <NavDropdown
                label="Friends"
                href="/friends"
                badge={incomingCount > 0 ? incomingCount : undefined}
                items={[
                  { label: "Add friend", href: "/friends/new" },
                  { label: "Friends list", href: "/friends" },
                ]}
              />
              <NavDropdown
                label="Groups"
                href="/groups"
                items={[
                  { label: "New group", href: "/groups/new" },
                  { label: "Saved groups", href: "/groups" },
                ]}
              />
            </>
          )}

          {session?.user ? (
            <Link
              href="/settings"
              className="ml-2 flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm hover:border-ink transition-colors"
            >
              {session.user.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={session.user.image} alt="" referrerPolicy="no-referrer" className="h-6 w-6 rounded-full" />
              ) : (
                <span className="h-6 w-6 rounded-full bg-line" />
              )}
              {session.user.name?.split(" ")[0] ?? "Profile"}
            </Link>
          ) : (
            <Link href="/login" className="rounded-full border border-line px-4 py-2 text-sm hover:border-ink transition-colors">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function NavDropdown({
  label,
  href,
  items,
  badge,
}: {
  label: string;
  href: string;
  items: { label: string; href: string }[];
  badge?: number;
}) {
  return (
    <div className="group relative">
      <Link href={href} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-ink/70 hover:text-ink transition-colors">
        {label}
        {badge !== undefined && (
          <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber px-1 text-[10px] font-bold leading-none text-white">
            {badge}
          </span>
        )}
      </Link>
      <div className="invisible absolute left-0 top-full -translate-y-1 pt-1 opacity-0 transition-all duration-150 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
        <div className="min-w-[160px] rounded-xl border border-line bg-white py-1.5 shadow-sm">
          {items.map((item) => (
            <Link key={item.href} href={item.href} className="block px-4 py-2 text-sm text-ink/70 hover:bg-paper hover:text-ink">
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}