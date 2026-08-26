"use client";

import { useState } from "react";
import { usePendingAction } from "../hooks/usePendingAction";
import { buttonClass } from "../lib/buttonStyles";
import Avatar from "./Avatar";
import SessionEndedNotice from "./SessionEndedNotice";

type SuggestedUser = { id: string; name: string | null; email: string | null; image: string | null };

export default function SuggestedFriendChip({ user, onGone }: { user: SuggestedUser; onGone: (userId: string) => void }) {
  // `hold` rather than `commit` on success: this chip doesn't wait on a server
  // re-render, it hands off to the parent, which fades and collapses the row
  // over the best part of a second before unmounting it. Clearing the pending
  // flag at any point in there would hand back live buttons on a suggestion
  // that's visibly on its way out -- the longest version of exactly the gap
  // hooks/usePendingAction exists to close.
  const { pending, busy, begin, release, hold } = usePendingAction<"send" | "dismiss">();
  const [error, setError] = useState<string | null>(null);
  // Holds the phrase for the notice rather than a bare flag, since the two
  // buttons end the same sentence differently. Null means no 401.
  const [sessionEnded, setSessionEnded] = useState<string | null>(null);

  async function handleSend() {
    if (!user.email) return;
    begin("send");
    setError(null);
    setSessionEnded(null);
    const res = await fetch("/api/friends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email }),
    });
    if (res.ok) {
      hold();
      onGone(user.id);
      return;
    }
    release();
    // This chip only renders on a page that already guards on a session, so a
    // 401 means it ended with the tab open. Passing body.error through would
    // print the API's bare "Unauthorized" -- see SessionEndedNotice.
    if (res.status === 401) {
      setSessionEnded("send this request");
      return;
    }
    const body = await res.json().catch(() => null);
    setError(typeof body?.error === "string" ? body.error : "Couldn't send that request.");
  }

  async function handleDismiss() {
    begin("dismiss");
    setError(null);
    setSessionEnded(null);
    const res = await fetch("/api/friends/suggestions/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    });
    if (res.ok) {
      hold();
      onGone(user.id);
      return;
    }
    release();
    // Never showed the raw string, but "Couldn't dismiss this suggestion" is a
    // dead end when the real problem is a session that ended and can be renewed.
    if (res.status === 401) {
      setSessionEnded("dismiss this suggestion");
      return;
    }
    setError("Couldn't dismiss this suggestion.");
  }

  const displayName = user.name ?? user.email ?? "Someone";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3">
      <div className="flex items-center gap-2.5">
        <Avatar image={user.image} name={user.name} email={user.email} size={32} />
        <div>
          <div className="text-sm font-medium">{displayName}</div>
          {user.name && <div className="text-xs text-ink/40">{user.email}</div>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={handleSend}
          disabled={busy}
          className={buttonClass({ variant: "primary" })}
        >
          {pending === "send" ? "Sending…" : "Send request"}
        </button>
        <button
          onClick={handleDismiss}
          disabled={busy}
          className={buttonClass({ variant: "danger" })}
        >
          {pending === "dismiss" ? "Dismissing…" : "Dismiss"}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {sessionEnded && <SessionEndedNotice action={sessionEnded} className="text-xs text-red-600" />}
    </div>
  );
}
