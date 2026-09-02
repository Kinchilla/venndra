import Link from "next/link";
import { prisma } from "../lib/prisma";
import Avatar from "./Avatar";
import { displayName } from "../lib/displayName";
import Logo from "./Logo";
import CountBadge from "./CountBadge";
import { buttonClass } from "../lib/buttonStyles";
import { currentUser } from "../lib/session";

export default async function SiteHeader() {
  const sessionUser = await currentUser();

  // The friends badge clears itself (a request is accepted or declined and it's
  // gone); the events one is deliberately a standing count rather than a
  // "since you last looked" unread, so it keeps nagging until every search
  // either locks in a time or is cancelled. It's the same set as the "Still
  // deciding" section on /events, so the number always has somewhere to land.
  //
  // Branches on sessionUser itself. It used to derive a `userId` first, test
  // that, and then reach for `session!.user!.email` inside the branch -- two
  // assertions standing in for a fact that was true but no longer provable
  // once the condition had been rewritten in terms of a derived value. Testing
  // the thing you are about to read costs nothing and needs no assertions.
  const [incomingCount, searchingCount] = sessionUser
    ? await Promise.all([
        prisma.friendship.count({ where: { addresseeId: sessionUser.id, status: "PENDING" } }),
        prisma.event.count({
          where: {
            status: "SEARCHING",
            OR: [{ creatorId: sessionUser.id }, { participants: { some: { email: sessionUser.email ?? "" } } }],
          },
        }),
      ])
    : [0, 0];

  // Declared once and rendered twice -- as hover dropdowns on the bar itself,
  // and as a flat row of the same top-level links below it on phones. Two
  // renderings of one list rather than two lists, so a section can't be added
  // to the desktop nav and quietly go missing from the phone one.
  const sections = [
    {
      label: "Events",
      href: "/events",
      badge: searchingCount,
      items: [
        { label: "New event", href: "/events/new" },
        { label: "Existing events", href: "/events" },
      ],
    },
    {
      label: "Friends",
      href: "/friends",
      badge: incomingCount,
      items: [
        { label: "Add friend", href: "/friends/new" },
        { label: "Friends list", href: "/friends" },
      ],
    },
    {
      label: "Groups",
      href: "/groups",
      items: [
        { label: "New group", href: "/groups/new" },
        { label: "Saved groups", href: "/groups" },
      ],
    },
  ];

  return (
    <header className="border-b border-line/60 bg-paper/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-6 py-3">
        <Link href="/" aria-label="Venndra — home" className="inline-flex shrink-0 items-baseline">
          <span className="font-display text-lg font-semibold">Ve</span>
          <Logo height={9.5} className="relative top-[0.5px]" />
          <span className="font-display text-lg font-semibold">dra</span>
        </Link>

        <div className="flex items-center gap-1">
          {/*
            Hidden rather than shrunk below `sm`, because there is no width to
            find: the three links and the account button measure 340px, the
            wordmark 65px, and the row's own padding 48px -- 453px of content
            in a 375px viewport. Closing every gap in the row (3 x gap-1, plus
            the account button's ml-2) recovers 20px of the 78 that are
            missing, so the nav has to leave the row entirely, and it reappears
            beneath the bar instead (below).

            `hidden` and not `invisible`/`w-0`: display:none is what removes
            the dropdown panels from layout too. They're `absolute`, but each
            one still carries min-w-[160px], and the Groups panel was reaching
            x=421 of a 375px viewport on its own.
          */}
          {sessionUser && (
            <nav className="hidden items-center gap-1 sm:flex">
              {sections.map((section) => (
                <NavDropdown key={section.href} {...section} />
              ))}
            </nav>
          )}

          {sessionUser ? (
            <Link
              href="/settings"
              className={buttonClass({ variant: "neutral", size: "nav", className: "flex items-center gap-2 sm:ml-2" })}
            >
              {/* Your own header, so the address in the fallback is your own
                  -- displayName's email step is showing you something you
                  already know, not disclosing anything. colorKey is the id so
                  the circle matches the one your friends see. */}
              <Avatar
                image={sessionUser.image}
                name={displayName(sessionUser)}
                colorKey={sessionUser.id}
                size={24}
              />
              {sessionUser.name?.split(" ")[0] ?? "Profile"}
            </Link>
          ) : (
            <Link href="/login" className={buttonClass({ variant: "neutral" })}>
              Sign in
            </Link>
          )}
        </div>
      </div>

      {/*
        The phone nav: the same three destinations, on their own row, as the
        plain links the dropdowns already point at. No dropdown down here, and
        not for want of space -- opening one needs a hover, and on a touchscreen
        the tap that would stand in for it just follows the link instead. So the
        second-level items ("New event", "Add friend") were already all but
        unreachable on a phone. Each is a button on the page it links to, which
        is where a phone reaches them.

        px-3 rather than the bar's px-6 so the pills' LABELS line up under the
        wordmark: the nav size carries px-3 of its own, and 12 + 12 is the 24
        the bar's px-6 puts the "Ve" at. Matching the container padding instead
        would indent the text by a pill's worth and read as a stray margin.
      */}
      {sessionUser && (
        <nav className="mx-auto flex max-w-5xl items-center gap-1 px-3 pb-3 sm:hidden">
          {sections.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className={buttonClass({ variant: "nav", size: "nav", className: "flex items-center gap-1.5" })}
            >
              {section.label}
              <CountBadge count={section.badge ?? 0} />
            </Link>
          ))}
        </nav>
      )}
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
      <Link href={href} className={buttonClass({ variant: "nav", size: "nav", className: "flex items-center gap-1.5" })}>
        {label}
        <CountBadge count={badge ?? 0} />
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