"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { usePendingAction } from "../hooks/usePendingAction";
import { buttonClass } from "../lib/buttonStyles";
import { PAUSED_TAG } from "../lib/pause";
import { displayName } from "../lib/displayName";
import Avatar from "./Avatar";

type FriendUser = { id: string; name: string | null; email: string | null; image: string | null; paused: boolean };
type Action = "remove" | "cancel" | "decline" | "accept";

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
  // Every action on this chip ends with the chip itself leaving the list, so
  // the buttons stay inactive until the refreshed tree has committed rather
  // than until the fetch resolves -- see hooks/usePendingAction.
  const { pending, busy, begin, release, commit } = usePendingAction<Action>();
  const [error, setError] = useState<string | null>(null);

  async function act(
    action: Action,
    url: string,
    method: string,
    failureMessage = "That didn't work — try again."
  ) {
    begin(action);
    setError(null);
    const res = await fetch(url, { method });
    if (res.ok) {
      commit(() => router.refresh());
    } else {
      release();
      setError(failureMessage);
    }
  }

  async function handleRemove() {
    if (!confirm("Remove this friend? You can always send a new request later.")) return;
    act("remove", `/api/friends/${friendshipId}`, "DELETE");
  }

  async function handleAccept() {
    act("accept", `/api/friends/${friendshipId}/accept`, "POST", "Couldn't accept this request.");
  }

  const label = displayName(user);

  return (
    <div className="rounded-xl border border-line bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        {/* Paused friends are dimmed, not removed: this is still a real
            friendship, and the only thing that's changed is that new events
            can't include them. Fading the identity while leaving the row's
            own buttons at full strength says exactly that -- removing a friend
            is unaffected by whether they've paused. */}
        <div className={`flex min-w-0 items-center gap-2.5 ${user.paused ? "opacity-50" : ""}`}>
          <Avatar image={user.image} name={label} colorKey={user.id} size={32} />
          {/* One line, not two. There used to be an email address under the
              name here, and issue #6 is that it had no business being there:
              Suggested Friends offers you friends-of-friends, so accepting one
              taught you an address its owner had never given you. What's left
              is whatever they chose to be called -- see lib/displayName. */}
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {label}
              {user.paused && <span className="ml-2 text-xs font-normal text-ink/40">· {PAUSED_TAG}</span>}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {kind === "friend" && (
            <button
              onClick={handleRemove}
              disabled={busy}
              className={buttonClass({ variant: "danger" })}
            >
              {pending === "remove" ? "Removing…" : "Remove friend"}
            </button>
          )}
          {kind === "sent" && (
            <button
              onClick={() => act("cancel", `/api/friends/${friendshipId}`, "DELETE")}
              disabled={busy}
              className={buttonClass({ variant: "danger" })}
            >
              {pending === "cancel" ? "Cancelling…" : "Cancel request"}
            </button>
          )}
          {kind === "received" && (
            <>
              <button
                onClick={handleAccept}
                disabled={busy}
                className={buttonClass({ variant: "primary" })}
              >
                {pending === "accept" ? "Accepting…" : "Accept"}
              </button>
              <button
                onClick={() => act("decline", `/api/friends/${friendshipId}`, "DELETE")}
                disabled={busy}
                className={buttonClass({ variant: "danger" })}
              >
                {pending === "decline" ? "Declining…" : "Decline"}
              </button>
            </>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
