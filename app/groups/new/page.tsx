import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import BackButton from "../../../components/BackButton";
import GroupForm from "../../../components/GroupForm";
import { WeeklyHours } from "../../../components/FiltersBuilder";

export default async function NewGroupPage() {
  // Deliberately no redirect for a missing session -- this page didn't gate on
  // one before, and the form handles the signed-out case itself. The lookup is
  // only here to seed the "Custom search window" picker with the user's own
  // /settings default, so falling through with null is fine.
  const session = await getServerSession(authOptions);
  const user = session?.user
    ? await prisma.user.findUnique({ where: { id: (session.user as any).id } })
    : null;

  return (
    <main className="mx-auto max-w-lg px-6 py-12">
      <BackButton fallbackHref="/groups" />
      <h1 className="font-display text-2xl font-semibold">New saved group</h1>
      <p className="mt-1 text-ink/60">Reuse this any time you need to find a slot with the same people.</p>
      <GroupForm userDefaultFilters={(user?.defaultSearchFilters as WeeklyHours | null) ?? null} />
    </main>
  );
}
