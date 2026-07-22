import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "../../lib/auth";
import { prisma } from "../../lib/prisma";
import BackButton from "../../components/BackButton";
import ProfileForm from "../../components/ProfileForm";
import CalendarSourcesPanel from "../../components/CalendarSourcesPanel";
import ConnectAppleForm from "../../components/ConnectAppleForm";
import LogoutButton from "../../components/LogoutButton";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/settings");

  const userId = (session.user as any).id;
  const [user, groups] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.savedGroup.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
  ]);
  if (!user) redirect("/login");

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <BackButton fallbackHref="/events" />
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">Settings</h1>
        <LogoutButton />
      </div>

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold">Profile</h2>
        <div className="mt-3">
          <ProfileForm initialName={user.name ?? ""} initialTimezone={user.timezone} image={user.image} />
        </div>
      </section>

      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Saved groups</h2>
          <Link href="/groups/new" className="text-sm text-teal hover:underline">
            + New group
          </Link>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {groups.map((g) => (
            <Link
              key={g.id}
              href={`/groups/${g.id}/edit`}
              className="rounded-full border border-line bg-white px-3 py-1.5 text-xs hover:border-ink transition-colors"
            >
              {g.name} <span className="text-ink/40">· {g.emails.length}</span>
            </Link>
          ))}
          {groups.length === 0 && <p className="text-sm text-ink/50">No saved groups yet.</p>}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-lg font-semibold">Connected calendars</h2>
        <p className="mt-1 text-sm text-ink/50">
          Pick which calendars count toward your availability, and which one new events get added to.
        </p>
        <div className="mt-3">
          <CalendarSourcesPanel />
        </div>
        <div className="mt-3">
          <ConnectAppleForm />
        </div>
      </section>
    </main>
  );
}
