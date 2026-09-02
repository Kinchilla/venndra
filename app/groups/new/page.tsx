import { redirect } from "next/navigation";
import { prisma } from "../../../lib/prisma";
import BackButton from "../../../components/BackButton";
import GroupForm from "../../../components/GroupForm";
import { asWeeklyHours } from "../../../lib/searchWindow";
import { currentUser } from "../../../lib/session";

export default async function NewGroupPage() {
  const sessionUser = await currentUser();
  // This used to fall through without a session, on the theory that GroupForm
  // handled the signed-out case itself. It doesn't: it reads the session only
  // to prefill the member list with your own address, and a signed-out save
  // gets a 401 from /api/groups that surfaces as the generic "Couldn't save
  // that group" -- no mention of signing in, and no way to get there without
  // losing what's been typed. Gate it here instead, like every other page.
  if (!sessionUser) redirect("/login?callbackUrl=/groups/new");

  // Only here to seed the "Custom search window" picker with the user's own
  // /settings default.
  const user = await prisma.user.findUnique({ where: { id: sessionUser.id } });

  return (
    <main className="mx-auto max-w-lg px-6 py-12">
      <BackButton fallbackHref="/groups" />
      <h1 className="font-display text-2xl font-semibold">New saved group</h1>
      <p className="mt-1 text-ink/60">Reuse this any time you need to find a slot with the same people.</p>
      <GroupForm userDefaultFilters={asWeeklyHours(user?.defaultSearchFilters)} />
    </main>
  );
}
