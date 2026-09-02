import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "../../lib/prisma";
import { buttonClass } from "../../lib/buttonStyles";
import { asWeeklyHours } from "../../lib/searchWindow";
import BackButton from "../../components/BackButton";
import GroupChip from "../../components/GroupChip";
import Paginated from "../../components/Paginated";
import ConnectCalendarBanner from "../../components/ConnectCalendarBanner";
import DisplayNameBanner from "../../components/DisplayNameBanner";
import { currentUser } from "../../lib/session";

export default async function GroupsPage() {
  const sessionUser = await currentUser();
  if (!sessionUser) redirect("/login");
  const userId = sessionUser.id;

  const groups = await prisma.savedGroup.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  const allEmails = [...new Set(groups.flatMap((g) => g.emails))];
  const users = allEmails.length
    ? await prisma.user.findMany({
        where: { email: { in: allEmails } },
        select: { id: true, email: true, name: true, image: true },
      })
    : [];
  const byEmail = new Map(users.map((u) => [u.email, u]));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <BackButton fallbackHref="/events" />
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">Groups</h1>
        <Link href="/groups/new" className={buttonClass({ variant: "primary" })}>
          + New group
        </Link>
      </div>

      <ConnectCalendarBanner />

      <DisplayNameBanner />

      <div className="mt-8 grid grid-cols-1 gap-2">
        <Paginated>
          {groups.map((g) => (
            <GroupChip
              key={g.id}
              id={g.id}
              name={g.name}
              members={g.emails.map((email) => ({
                email,
                userId: byEmail.get(email)?.id ?? null,
                name: byEmail.get(email)?.name ?? null,
                image: byEmail.get(email)?.image ?? null,
              }))}
              filters={asWeeklyHours(g.defaultFilters) ?? {}}
            />
          ))}
        </Paginated>
        {groups.length === 0 && <p className="text-sm text-ink/50">No saved groups yet.</p>}
      </div>
    </main>
  );
}
