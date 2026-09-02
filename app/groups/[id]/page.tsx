import { notFound, redirect } from "next/navigation";
import { prisma } from "../../../lib/prisma";
import BackButton from "../../../components/BackButton";
import GroupForm from "../../../components/GroupForm";
import { asWeeklyHours } from "../../../lib/searchWindow";
import { currentUser } from "../../../lib/session";

export default async function EditGroupPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const sessionUser = await currentUser();
  if (!sessionUser) redirect(`/login?callbackUrl=/groups/${params.id}`);

  const group = await prisma.savedGroup.findUnique({ where: { id: params.id } });
  if (!group || group.userId !== sessionUser.id) notFound();

  // Seeds the picker if this group has no window yet and the user switches the
  // toggle on -- otherwise they'd start from a blank grid.
  const user = await prisma.user.findUnique({ where: { id: sessionUser.id } });

  return (
    <main className="mx-auto max-w-lg px-6 py-12">
      <BackButton fallbackHref="/groups" />
      <h1 className="font-display text-2xl font-semibold">Edit saved group</h1>
      <p className="mt-1 text-ink/60">
        Changes here only affect future searches — anything already in progress keeps its original invite list.
      </p>
      <GroupForm
        groupId={group.id}
        initialName={group.name}
        initialEmails={group.emails}
        initialFilters={asWeeklyHours(group.defaultFilters) ?? undefined}
        userDefaultFilters={asWeeklyHours(user?.defaultSearchFilters)}
      />
    </main>
  );
}
