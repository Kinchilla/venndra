import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "../../lib/auth";
import { prisma } from "../../lib/prisma";
import BackButton from "../../components/BackButton";
import FriendChip from "../../components/FriendChip";

export default async function FriendsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const userId = (session.user as any).id;

  const [sent, received, groups] = await Promise.all([
    prisma.friendship.findMany({
      where: { requesterId: userId },
      include: { addressee: { select: { id: true, name: true, email: true, image: true } } },
    }),
    prisma.friendship.findMany({
      where: { addresseeId: userId },
      include: { requester: { select: { id: true, name: true, email: true, image: true } } },
    }),
    prisma.savedGroup.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
  ]);

  const friends = [
    ...sent.filter((f) => f.status === "ACCEPTED").map((f) => ({ id: f.id, user: f.addressee })),
    ...received.filter((f) => f.status === "ACCEPTED").map((f) => ({ id: f.id, user: f.requester })),
  ];
  const pendingSent = sent.filter((f) => f.status === "PENDING").map((f) => ({ id: f.id, user: f.addressee }));
  const pendingReceived = received.filter((f) => f.status === "PENDING").map((f) => ({ id: f.id, user: f.requester }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <BackButton fallbackHref="/" />
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">Friends</h1>
        <Link href="/friends/new" className="rounded-full bg-amber px-4 py-2 text-sm font-medium text-white">
          + Add friend
        </Link>
      </div>

      <section className="mt-8">
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

      <FriendSection title="Friends" entries={friends} kind="friend" />
      <FriendSection title="Sent requests" entries={pendingSent} kind="sent" />
      <FriendSection title="Received requests" entries={pendingReceived} kind="received" />
    </main>
  );
}

function FriendSection({
  title,
  entries,
  kind,
}: {
  title: string;
  entries: { id: string; user: { id: string; name: string | null; email: string | null; image: string | null } }[];
  kind: "friend" | "sent" | "received";
}) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <div className="mt-3 grid gap-2">
        {entries.map((e) => (
          <FriendChip key={e.id} friendshipId={e.id} user={e.user} kind={kind} />
        ))}
        {entries.length === 0 && <p className="text-sm text-ink/50">Nothing here yet.</p>}
      </div>
    </section>
  );
}