"use client";

import { useEffect, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { buttonClass } from "../../lib/buttonStyles";
import { signInErrorMessage } from "../../lib/authErrors";

export default function LoginPage() {
  const params = useSearchParams();
  const router = useRouter();
  const { status } = useSession();
  const callbackUrl = params.get("callbackUrl") ?? "/events";
  const error = params.get("error");
  const [signedOutError, setSignedOutError] = useState<string | null>(null);

  useEffect(() => {
    if (!error || status === "loading") return;
    if (status === "authenticated") {
      // Reached because authOptions.pages.error points every OAuth failure at
      // /login -- including failures from "connect another account", which
      // isn't a sign-in and leaves the session completely untouched. Showing a
      // signed-in person a sign-in form reads as "you got logged out", so bounce
      // back to where they actually were with the code, and let Settings explain.
      //
      // Deliberately ALL error codes, not just OAuthAccountNotLinked: any other
      // failure used to land here and render a bare sign-in form with nothing
      // said about what went wrong.
      router.replace(`/settings?connectError=${encodeURIComponent(error)}`);
      return;
    }
    // Genuinely signed out, so this really was a sign-in attempt. Explain it
    // here rather than redirecting anywhere.
    setSignedOutError(error);
  }, [error, status, router]);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="font-display text-3xl font-semibold">Sign in to Venndra</h1>
      <p className="mt-2 text-ink/70">
        Connecting a calendar lets Venndra see your busy times — it never shares event details, just "free," "tentative," or "busy."
      </p>

      {signedOutError && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {signInErrorMessage(signedOutError)}
        </p>
      )}

      <div className="mt-8 flex flex-col gap-3">
        <button
          onClick={() => signIn("google", { callbackUrl })}
          className={buttonClass({ variant: "neutral", size: "xl", className: "bg-white font-medium" })}
        >
          Continue with Google
        </button>
        <button
          onClick={() => signIn("azure-ad", { callbackUrl })}
          className={buttonClass({ variant: "neutral", size: "xl", className: "bg-white font-medium" })}
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
