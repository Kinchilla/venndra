import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import BackButton from "../../../components/BackButton";
import GroupForm from "../../../components/GroupForm";

export default async function EditGroupPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect(`/login?callbackUrl=/groups/${params.id}`);

  const group = await prisma.savedGroup.findUnique({ where: { id: params.id } });
  if (!group || group.userId !== (session.user as any).id) notFound();

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
        initialFilters={(group.defaultFilters as any) ?? undefined}
      />
    </main>
  );
}
