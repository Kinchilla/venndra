"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import ConnectAppleForm from "./ConnectAppleForm";

export default function JoinPrompt({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [checking, setChecking] = useState(false);

  async function refreshStatus() {
    setChecking(true);
    await fetch(`/api/events/${eventId}/join`, { method: "POST" });
    setChecking(false);
    router.refresh();
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
          className="rounded-full border border-line px-4 py-2 text-sm hover:border-ink transition-colors"
        >
          Connect Google
        </button>
        <button
          onClick={() => signIn("azure-ad", { callbackUrl: `/events/${eventId}` })}
          className="rounded-full border border-line px-4 py-2 text-sm hover:border-ink transition-colors"
        >
          Connect Microsoft
        </button>
      </div>
      <div className="mt-3">
        <ConnectAppleForm />
      </div>
      <button onClick={refreshStatus} disabled={checking} className="mt-4 text-xs text-teal hover:underline">
        {checking ? "Checking…" : "Already connected? Refresh"}
      </button>
    </div>
  );
}
