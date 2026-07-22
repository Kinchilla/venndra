"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ConnectAppleForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [appleId, setAppleId] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/calendars/apple", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appleId, appSpecificPassword: password, label: "iCloud" }),
    });

    setSubmitting(false);
    if (!res.ok) {
      setError("Couldn't connect that account — double check the app-specific password.");
      return;
    }
    setOpen(false);
    setAppleId("");
    setPassword("");
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-full border border-line px-4 py-2 text-sm hover:border-ink transition-colors"
      >
        + Connect iCloud calendar
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-line bg-white p-5">
      <p className="text-sm text-ink/70">
        Apple doesn't support one-click sign-in for third-party apps like this — you'll need an{" "}
        <a href="https://support.apple.com/en-us/102654" target="_blank" rel="noreferrer" className="underline">
          app-specific password
        </a>{" "}
        from appleid.apple.com. It only grants calendar access, and you can revoke it anytime. Note: iCloud can be
        used to check your availability, but can't yet be the calendar new events get written to.
      </p>
      <div className="mt-4 grid gap-3">
        <input
          type="email"
          placeholder="your iCloud email"
          value={appleId}
          onChange={(e) => setAppleId(e.target.value)}
          className="rounded-lg border border-line px-3 py-2 text-sm"
          required
        />
        <input
          type="password"
          placeholder="app-specific password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-lg border border-line px-3 py-2 text-sm font-mono-tight"
          required
        />
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={submitting} className="rounded-full bg-teal px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {submitting ? "Connecting…" : "Connect"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-full px-4 py-2 text-sm text-ink/60">
          Cancel
        </button>
      </div>
    </form>
  );
}
