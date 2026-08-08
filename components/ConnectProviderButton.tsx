"use client";

import { signIn } from "next-auth/react";
import { buttonClass } from "../lib/buttonStyles";

const LABELS = { google: "Google", "azure-ad": "Microsoft" } as const;

// `select_account` is the part that matters on both: it forces the provider's
// account chooser to appear even when the browser already has one account
// signed in, which is the whole point of a "connect ANOTHER account" button.
// Without it the second click silently re-authenticates whoever the browser
// already remembers, with no way to pick someone else.
//
// The values differ because the two providers parse this field differently.
// Google takes a space-delimited LIST, so `consent` rides along to force a
// fresh refresh_token (its provider config already asks for `prompt: "consent"`
// at first sign-in, and this call replaces that rather than adding to it).
// Microsoft's identity platform accepts exactly ONE value from
// login | none | consent | select_account, and rejects a combination outright
// with "AADSTS90023: Unsupported 'prompt' value" -- so it gets `select_account`
// alone. Nothing is lost: Microsoft returns a refresh_token whenever
// `offline_access` is in the scope list, which lib/auth.ts already requests, so
// unlike Google it never needed `consent` to keep tokens refreshable.
const PROMPTS = { google: "select_account consent", "azure-ad": "select_account" } as const;

export default function ConnectProviderButton({ provider }: { provider: "google" | "azure-ad" }) {
  return (
    <button
      onClick={() =>
        // Only overrides the prompt for this specific call -- first sign-in via
        // /login still uses each provider's own configured authorization params.
        signIn(provider, { callbackUrl: "/settings" }, { prompt: PROMPTS[provider] })
      }
      className={buttonClass({ variant: "neutral" })}
    >
      + Connect {LABELS[provider]} account
    </button>
  );
}
