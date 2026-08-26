"use client";

import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { usePendingAction } from "../hooks/usePendingAction";
import ConnectAppleForm from "./ConnectAppleForm";
import { buttonClass } from "../lib/buttonStyles";

export default function JoinPrompt({ eventId }: { eventId: string }) {
  const router = useRouter();
  // A successful join replaces this whole prompt with the event's results, so
  // the button stays inactive until that refreshed tree commits rather than
  // going live again while the old prompt is still on screen.
  const { pending, busy, begin, commit } = usePendingAction<"check">();

  async function refreshStatus() {
    begin("check");
    await fetch(`/api/events/${eventId}/join`, { method: "POST" });
    commit(() => router.refresh());
  }

  return (
    <div className="rounded-2xl border border-line bg-white p-6">
      <p className="text-sm text-ink/70">
        Connect a calendar so Venndra can count your free time toward this search — it only ever shares
        free/tentative/busy, never event details.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => signIn("google", { callbackUrl: `/events/${eventId}` })}
          className={buttonClass({ variant: "neutral" })}
        >
          Connect Google
        </button>
        <button
          onClick={() => signIn("azure-ad", { callbackUrl: `/events/${eventId}` })}
          className={buttonClass({ variant: "neutral" })}
        >
          Connect Microsoft
        </button>
      </div>
      <div className="mt-3">
        <ConnectAppleForm />
      </div>
      <button onClick={refreshStatus} disabled={busy} className="mt-4 text-xs text-teal hover:underline">
        {pending === "check" ? "Checking…" : "Already connected? Refresh"}
      </button>
    </div>
  );
}
