import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../../lib/auth";
import { prisma } from "../../lib/prisma";
import { connectErrorMessage } from "../../lib/authErrors";
import { hasUsableCalendar } from "../../lib/onboarding";
import { upcomingConfirmedWhere } from "../../lib/eventLifecycle";
import BackButton from "../../components/BackButton";
import ProfileForm from "../../components/ProfileForm";
import DefaultSearchTimesForm from "../../components/DefaultSearchTimesForm";
import { WeeklyHours } from "../../components/FiltersBuilder";
import CalendarSourcesPanel from "../../components/CalendarSourcesPanel";
import ConnectedAccountsSection from "../../components/ConnectedAccountsSection";
import LogoutButton from "../../components/LogoutButton";
import AccountManagement from "../../components/AccountManagement";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: { connectError?: string; needsCalendar?: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/settings");

  const userId = (session.user as any).id;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) redirect("/login");

  // The ?needsCalendar flag says how the user GOT here, not what's still true.
  // It sticks in the URL for the whole visit, so connecting a calendar has to
  // be able to clear the banner on its own -- ConnectAppleForm calls
  // router.refresh() on success, which re-runs this and flips the check.
  // Without the second half, the banner outlived the problem it described and
  // told someone who had just connected iCloud that they still hadn't.
  const showNeedsCalendar = !!searchParams?.needsCalendar && !(await hasUsableCalendar(userId));

  // Counted here rather than fetched by the section itself: it's one cheap
  // query on a page that's already doing several, and it means the delete
  // dialog can name a real number the instant it opens instead of opening
  // with a gap in the sentence while a request is in flight. Matches what
  // DELETE /api/me will actually cancel -- searches in progress plus
  // confirmed events still to come, never anything already past.
  const upcomingOrganizedCount = await prisma.event.count({
    where: { creatorId: userId, OR: [{ status: "SEARCHING" }, upcomingConfirmedWhere()] },
  });

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <BackButton fallbackHref="/events" />
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">Settings</h1>
        <LogoutButton />
      </div>

      {/*
        Both banners explain why the user is on a page they didn't navigate to
        themselves, so they belong together at the top -- above Profile, which
        is otherwise the first thing a redirected user sees.

        The error one used to live inside the Connected calendars section, on
        the reasoning that it was always about connecting an account and so
        belonged next to the buttons that retry it. That stopped being true
        twice over. It sat below Profile and Default search times, far enough
        down that someone bounced here by a failure could easily never scroll
        to the explanation; and /login now forwards magic-link codes
        (Verification, EmailSignin) through the same param, which have nothing
        to do with calendars at all.
      */}
      {searchParams?.connectError && (
        <p className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {connectErrorMessage(searchParams.connectError)}
        </p>
      )}

      {/* Set by /events/new when it turns away a user with no calendar. Says
          why they're on a page they didn't ask for -- a silent redirect to
          Settings otherwise just reads as a broken "New event" button. */}
      {showNeedsCalendar && (
        <p className="mt-6 rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-sm text-ink/70">
          <span className="font-medium text-ink">Connect a calendar first.</span> Venndra builds a search by comparing
          your free time against everyone else&apos;s, so a search started without your calendar would suggest times you
          might not actually be free. Connect one below and the event form will open normally.
        </p>
      )}

      <section className="mt-8">
        <h2 className="font-display text-lg font-semibold">Profile</h2>
        <div className="mt-3">
          <ProfileForm
            initialName={user.name ?? ""}
            initialTimezone={user.timezone}
            image={user.image}
            email={user.email}
          />
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
      </section>

      <section className="mt-10">
        <h2 className="font-display text-lg font-semibold">Connected accounts</h2>
        <p className="mt-1 text-sm text-ink/50">
          The accounts Venndra reads calendars from. Connect another below, or disconnect one, which removes it from
          Venndra entirely.
        </p>
        <ConnectedAccountsSection />
      </section>

      {/* Last on the page on purpose, but otherwise an ordinary section like
          the four above it. Nothing here is part of routine
          settings-tending, and both controls reach other people -- so they
          sit past everything someone came to this page to actually do. That
          ordering is the whole of the emphasis; it needs no box to say it
          again. */}
      <section className="mt-10">
        <h2 className="font-display text-lg font-semibold">Account management</h2>
        <p className="mt-1 text-sm text-ink/50">
          Pause your account to stop being added to new events for a while, or delete it from Venndra entirely.
        </p>
        <AccountManagement initialPaused={user.pausedAt !== null} upcomingOrganizedCount={upcomingOrganizedCount} />
      </section>
    </main>
  );
}