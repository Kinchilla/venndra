import { redirect } from "next/navigation";
import Link from "next/link";
import { buttonClass } from "../../lib/buttonStyles";
import { loadFriendLists, type FriendListEntry } from "../../lib/friends";
import BackButton from "../../components/BackButton";
import FriendChip from "../../components/FriendChip";
import Paginated from "../../components/Paginated";
import ConnectCalendarBanner from "../../components/ConnectCalendarBanner";
import DisplayNameBanner from "../../components/DisplayNameBanner";
import { currentUser } from "../../lib/session";

export default async function FriendsPage() {
  const sessionUser = await currentUser();
  if (!sessionUser) redirect("/login");
  // Shared with GET /api/friends, which returns these same three lists over
  // HTTP (#30). Both used to build them out of the same two queries and the
  // same three-way partition, written out twice.
  const { friends, pendingSent, pendingReceived } = await loadFriendLists(sessionUser.id);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <BackButton fallbackHref="/" />
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">Friends</h1>
        <Link href="/friends/new" className={buttonClass({ variant: "primary" })}>
          + Add friend
        </Link>
      </div>

      <ConnectCalendarBanner />

      <DisplayNameBanner />

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
  entries: FriendListEntry[];
  kind: "friend" | "sent" | "received";
}) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <div className="mt-3 grid grid-cols-1 gap-2">
        <Paginated>
          {entries.map((e) => (
            <FriendChip key={e.friendshipId} friendshipId={e.friendshipId} user={e.user} kind={kind} />
          ))}
        </Paginated>
        {entries.length === 0 && <p className="text-sm text-ink/50">Nothing here yet.</p>}
      </div>
    </section>
  );
}