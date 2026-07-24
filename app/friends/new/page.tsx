"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BackButton from "../../../components/BackButton";

export default function NewFriendPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{ exists: boolean; name: string | null } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setCheckResult(null);
      return;
    }
    setChecking(true);
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/friends/check?email=${encodeURIComponent(email.trim())}`);
        setCheckResult(await res.json());
      } finally {
        setChecking(false);
      }
    }, 400);
    return () => clearTimeout(timeout);
  }, [email]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/friends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === "string" ? body.error : "Couldn't send that request.");
      return;
    }
    setSuccess(true);
    setTimeout(() => router.push("/friends"), 900);
  }

  return (
    <main className="mx-auto max-w-md px-6 py-12">
      <BackButton fallbackHref="/friends" />
      <h1 className="font-display text-2xl font-semibold">Add a friend</h1>
      <p className="mt-1 text-ink/60">They'll need to accept before you can plan events together.</p>

      <form onSubmit={handleSubmit} className="mt-6 grid gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-ink/60">Their email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full rounded-lg border border-line px-3 py-2"
            placeholder="friend@email.com"
          />
        </label>

        {checking && <p className="text-xs text-ink/40">Checking…</p>}
        {!checking && checkResult?.exists && (
          <p className="text-xs text-teal">✓ {checkResult.name ?? "This person"} is on Venndra</p>
        )}
        {!checking && checkResult && !checkResult.exists && (
          <p className="text-xs text-ink/40">No Venndra profile found for this email yet</p>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-teal">Request sent!</p>}

        <button
          type="submit"
          disabled={submitting || success}
          className="mt-2 w-fit rounded-full bg-amber px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? "Sending…" : "Send request"}
        </button>
      </form>
    </main>
  );
}