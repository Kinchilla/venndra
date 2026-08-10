"use client";

import { useState } from "react";
import { buttonClass } from "../lib/buttonStyles";
import Avatar from "./Avatar";

type SuggestedUser = { id: string; name: string | null; email: string | null; image: string | null };

export default function SuggestedFriendChip({ user, onGone }: { user: SuggestedUser; onGone: (userId: string) => void }) {
  const [loading, setLoading] = useState<"send" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    if (!user.email) return;
    setLoading("send");
    setError(null);
    const res = await fetch("/api/friends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email }),
    });
    setLoading(null);
    if (res.ok) {
      onGone(user.id);
    } else {
      const body = await res.json().catch(() => null);
      setError(typeof body?.error === "string" ? body.error : "Couldn't send that request.");
    }
  }

  async function handleDismiss() {
    setLoading("dismiss");
    setError(null);
    const res = await fetch("/api/friends/suggestions/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    });
    setLoading(null);
    if (res.ok) {
      onGone(user.id);
    } else {
      setError("Couldn't dismiss this suggestion.");
    }
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
          disabled={loading !== null}
          className={buttonClass({ variant: "primary" })}
        >
          {loading === "send" ? "Sending…" : "Send request"}
        </button>
        <button
          onClick={handleDismiss}
          disabled={loading !== null}
          className={buttonClass({ variant: "danger" })}
        >
          {loading === "dismiss" ? "Dismissing…" : "Dismiss"}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}