"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import "./globals.css";

/**
 * Layout-level fallback (issue #40) -- what renders when the root layout
 * itself throws, which means SiteHeader/SiteFooter and Providers are exactly
 * what's suspect and can't be trusted here. Next requires this file to render
 * its own <html>/<body> for that reason: there is no working layout left to
 * supply them.
 *
 * Kept deliberately simple and dependency-light for the same reason -- a
 * plain <a> rather than next/link, no buttonClass import, nothing that leans
 * on app state. This is the last line of defence; the more it shares with the
 * thing that just broke, the more likely it breaks the same way.
 *
 * Same captureException + digest tag as error.tsx, for the same reason: this
 * catches client-side errors in the root layout that never reach the server,
 * so onRequestError (instrumentation.ts) never sees them.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { digest: error.digest } });
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-paper text-ink antialiased">
        <main className="mx-auto flex max-w-5xl flex-col items-center px-6 py-24 text-center">
          <h1 className="font-display text-4xl font-semibold">Something went wrong</h1>
          <p className="mt-4 max-w-md text-ink/70">
            That&apos;s on us, not you. It&apos;s been reported -- reloading the page usually fixes it.
          </p>
          {error.digest && (
            <p className="mt-4 font-mono-tight text-xs text-ink/40">Reference: {error.digest}</p>
          )}
          {/*
            Deliberate, and verified in a production build: next/link does a
            SOFT navigation, and the global-error boundary does not reset on
            one. Clicking a <Link href="/"> here changes the URL to / but
            leaves this error page on screen -- even when the original throw
            is no longer reproducible, because it is the boundary that stays
            tripped, not the error that recurs. Only a full document load
            clears it, which is exactly what a plain <a> does.
          */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            className="mt-8 inline-block rounded-full bg-amber px-5 py-2.5 text-sm font-medium text-white transition hover:brightness-105"
          >
            Back home
          </a>
        </main>
      </body>
    </html>
  );
}
