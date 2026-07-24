"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type FriendUser = { id: string; name: string | null; email: string | null; image: string | null };

export default function FriendChip({
  friendshipId,
  user,
  kind,
}: {
  friendshipId: string;
  user: FriendUser;
  kind: "friend" | "sent" | "received";
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "remove" | "cancel" | "decline", url: string, method: string) {
    setLoading(action);
    setError(null);
    const res = await fetch(url, { method });
    setLoading(null);
    if (res.ok) {
      router.refresh();
    } else {
      setError("That didn't work — try again.");
    }
  }

  async function handleRemove() {
    if (!confirm("Remove this friend? You can always send a new request later.")) return;
    act("remove", `/api/friends/${friendshipId}`, "DELETE");
  }

  async function handleAccept() {
    setLoading("accept");
    setError(null);
    const res = await fetch(`/api/friends/${friendshipId}/accept`, { method: "POST" });
    setLoading(null);
    if (res.ok) router.refresh();
    else setError("Couldn't accept this request.");
  }

  const displayName = user.name ?? user.email ?? "Someone";

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3">
      <div className="flex items-center gap-2.5">
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt="" referrerPolicy="no-referrer" className="h-8 w-8 rounded-full" />
        ) : (
          <span className="h-8 w-8 shrink-0 rounded-full bg-line" />
        )}
        <div>
          <div className="text-sm font-medium">{displayName}</div>
          {user.name && <div className="text-xs text-ink/40">{user.email}</div>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {kind === "friend" && (
          <button
            onClick={handleRemove}
            disabled={loading !== null}
            className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink/70 hover:border-red-600 hover:text-red-600 disabled:opacity-50"
          >
            {loading === "remove" ? "Removing…" : "Remove friend"}
          </button>
        )}
        {kind === "sent" && (
          <button
            onClick={() => act("cancel", `/api/friends/${friendshipId}`, "DELETE")}
            disabled={loading !== null}
            className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink/70 hover:border-red-600 hover:text-red-600 disabled:opacity-50"
          >
            {loading === "cancel" ? "Cancelling…" : "Cancel request"}
          </button>
        )}
        {kind === "received" && (
          <>
            <button
              onClick={handleAccept}
              disabled={loading !== null}
              className="rounded-full bg-amber px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading === "accept" ? "Accepting…" : "Accept"}
            </button>
            <button
              onClick={() => act("decline", `/api/friends/${friendshipId}`, "DELETE")}
              disabled={loading !== null}
              className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink/70 hover:border-red-600 hover:text-red-600 disabled:opacity-50"
            >
              {loading === "decline" ? "Declining…" : "Decline"}
            </button>
          </>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}