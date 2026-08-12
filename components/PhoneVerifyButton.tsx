"use client";

import { useState } from "react";
import Link from "next/link";
import { buttonClass } from "../lib/buttonStyles";

/**
 * The one button on /verify-phone.
 *
 * A client component only because the page it sits on has to stay a server
 * component to read the user's number -- the press itself is the entire reason
 * verification isn't a GET (see app/api/me/phone/verify).
 */
export default function PhoneVerifyButton({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "working" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setState("working");
    setError(null);

    const res = await fetch("/api/me/phone/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(typeof body.error === "string" ? body.error : "Couldn't confirm that number.");
      setState("idle");
      return;
    }
    setState("done");
  }

  if (state === "done") {
    return (
      <div className="mt-6">
        <p className="text-sm text-teal">✓ Verified — friends can now find you by this number.</p>
        <Link
          href="/settings"
          className={buttonClass({ variant: "neutral", size: "lg", className: "mt-4 inline-block" })}
        >
          Back to Settings
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={confirm}
        disabled={state === "working"}
        className={buttonClass({ variant: "primary", size: "lg" })}
      >
        {state === "working" ? "Confirming…" : "Yes, this is my number"}
      </button>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
