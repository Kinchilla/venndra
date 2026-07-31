import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../../lib/auth";
import { prisma } from "../../lib/prisma";
import BackButton from "../../components/BackButton";
import ProfileForm from "../../components/ProfileForm";
import DefaultSearchTimesForm from "../../components/DefaultSearchTimesForm";
import { WeeklyHours } from "../../components/FiltersBuilder";
import CalendarSourcesPanel from "../../components/CalendarSourcesPanel";
import ConnectAppleForm from "../../components/ConnectAppleForm";
import LogoutButton from "../../components/LogoutButton";

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/settings");

  const userId = (session.user as any).id;
  const user = await prisma.user.findUnique({ where: { id: userId } });
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
        <h2 className="font-display text-lg font-semibold">Default search times</h2>
        <p className="mt-1 text-sm text-ink/50">
          Set your own default for the "Only look at" filter on new searches, instead of the app's built-in default (Mon–Fri, 6–10pm). Starting a search from a saved group still overrides this, same as today.
        </p>
        <div className="mt-3">
          <DefaultSearchTimesForm initialFilters={(user.defaultSearchFilters as WeeklyHours | null) ?? null} />
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