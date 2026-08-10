"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "../lib/buttonStyles";
import Avatar from "./Avatar";

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
        <Avatar image={user.image} name={user.name} email={user.email} size={32} />
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
            className={buttonClass({ variant: "danger" })}
          >
            {loading === "remove" ? "Removing…" : "Remove friend"}
          </button>
        )}
        {kind === "sent" && (
          <button
            onClick={() => act("cancel", `/api/friends/${friendshipId}`, "DELETE")}
            disabled={loading !== null}
            className={buttonClass({ variant: "danger" })}
          >
            {loading === "cancel" ? "Cancelling…" : "Cancel request"}
          </button>
        )}
        {kind === "received" && (
          <>
            <button
              onClick={handleAccept}
              disabled={loading !== null}
              className={buttonClass({ variant: "primary" })}
            >
              {loading === "accept" ? "Accepting…" : "Accept"}
            </button>
            <button
              onClick={() => act("decline", `/api/friends/${friendshipId}`, "DELETE")}
              disabled={loading !== null}
              className={buttonClass({ variant: "danger" })}
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