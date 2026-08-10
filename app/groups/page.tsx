import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "../../lib/auth";
import { prisma } from "../../lib/prisma";
import { buttonClass } from "../../lib/buttonStyles";
import BackButton from "../../components/BackButton";
import GroupChip from "../../components/GroupChip";
import Paginated from "../../components/Paginated";
import ConnectCalendarBanner from "../../components/ConnectCalendarBanner";

export default async function GroupsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const userId = (session.user as any).id;

  const groups = await prisma.savedGroup.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  const allEmails = [...new Set(groups.flatMap((g) => g.emails))];
  const users = allEmails.length
    ? await prisma.user.findMany({
        where: { email: { in: allEmails } },
        select: { email: true, name: true, image: true },
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

      <div className="mt-8 grid gap-2">
        <Paginated>
          {groups.map((g) => (
            <GroupChip
              key={g.id}
              id={g.id}
              name={g.name}
              members={g.emails.map((email) => ({
                email,
                name: byEmail.get(email)?.name ?? null,
                image: byEmail.get(email)?.image ?? null,
              }))}
              filters={(g.defaultFilters as any) ?? {}}
            />
          ))}
        </Paginated>
        {groups.length === 0 && <p className="text-sm text-ink/50">No saved groups yet.</p>}
      </div>
    </main>
  );
}
