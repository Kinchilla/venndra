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
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

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

      <div className="mt-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="font-mono-tight text-xs uppercase tracking-widest text-ink/40">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      {/* Email sign-in exists mainly for people whose only calendar is iCloud:
          Apple connects over CalDAV, which is a calendar connection and not a
          sign-in method, so before this they had no way to have an account at
          all. It doubles as a way back in for anyone who'd rather not use an
          OAuth button -- signing in by email reaches the SAME account as the
          Google or Microsoft one at that address, never a duplicate. */}
      <form
        className="mt-6"
        onSubmit={async (e) => {
          e.preventDefault();
          if (sending) return;
          setSending(true);
          // Sends the link and navigates to pages.verifyRequest on success, or
          // back here with ?error= if the send failed. Either way this page is
          // gone, so `sending` is never reset -- it only has to survive long
          // enough to stop a second submit.
          await signIn("email", { email: email.trim(), callbackUrl });
        }}
      >
        <label htmlFor="email" className="text-sm text-ink/70">
          Sign in with your email address
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="mt-2 w-full rounded-full border border-line bg-white px-5 py-3 text-sm outline-none focus:border-ink"
        />
        <button
          type="submit"
          disabled={sending || !email.trim()}
          className={buttonClass({ variant: "primary", size: "xl", className: "mt-3 w-full" })}
        >
          {sending ? "Sending…" : "Email me a sign-in link"}
        </button>
      </form>

      <p className="mt-6 text-xs text-ink/50">
        Only use an iCloud calendar? Sign in with your email address above, then connect it from Settings.
      </p>
    </main>
  );
}
