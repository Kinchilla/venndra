"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

export default function LoginPage() {
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? "/events";

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="font-display text-3xl font-semibold">Sign in to Venndra</h1>
      <p className="mt-2 text-ink/70">
        Connecting a calendar lets Venndra see your busy times — it never shares event details, just "free," "tentative," or "busy."
      </p>

      <div className="mt-8 flex flex-col gap-3">
        <button
          onClick={() => signIn("google", { callbackUrl })}
          className="rounded-full border border-line bg-white px-5 py-3 text-sm font-medium hover:border-ink transition-colors"
        >
          Continue with Google
        </button>
        <button
          onClick={() => signIn("azure-ad", { callbackUrl })}
          className="rounded-full border border-line bg-white px-5 py-3 text-sm font-medium hover:border-ink transition-colors"
        >
          Continue with Microsoft
        </button>
      </div>

      <p className="mt-6 text-xs text-ink/50">
        Have an iCloud calendar? You can connect it from your dashboard after
        signing in with Google or Microsoft first.
      </p>
    </main>
  );
}
