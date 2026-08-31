"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { buttonClass } from "../lib/buttonStyles";

/**
 * Route-level error boundary (issue #40). Every page here is a server
 * component reading per-user data -- friends, events, groups, availability --
 * so an unexpected throw is a real possibility, and without this Next falls
 * back to its own unstyled "Application error" page.
 *
 * Rendered as a child of the root layout, not a replacement for it (that's
 * what global-error.tsx is for), so the header/footer and their nav still
 * render around this -- a broken page shouldn't take the way out with it.
 *
 * Server-side render errors are already reported to Sentry via
 * `onRequestError` in instrumentation.ts, before this component ever mounts.
 * The explicit captureException here is for the other half: errors thrown
 * client-side, after hydration, which onRequestError never sees because
 * they never touch the server. Pairs with #38 -- tagging the digest is what
 * turns the hash on screen into something you can paste into Sentry's search.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { digest: error.digest } });
  }, [error]);

  return (
    <main className="mx-auto flex max-w-5xl flex-col items-center px-6 py-24 text-center">
      <h1 className="font-display text-4xl font-semibold">Something went wrong</h1>
      <p className="mt-4 max-w-md text-ink/70">
        That&apos;s on us, not you. It&apos;s been reported -- try again, or head back home.
      </p>
      {error.digest && (
        <p className="mt-4 font-mono-tight text-xs text-ink/40">Reference: {error.digest}</p>
      )}
      <div className="mt-8 flex items-center gap-3">
        <button onClick={() => reset()} className={buttonClass({ variant: "primary", size: "lg" })}>
          Try again
        </button>
        <Link href="/" className={buttonClass({ variant: "neutral", size: "lg" })}>
          Back home
        </Link>
      </div>
    </main>
  );
}
