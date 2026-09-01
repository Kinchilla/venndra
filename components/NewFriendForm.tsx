"use client";

import { useEffect, useState } from "react";
import BackButton from "./BackButton";
import SessionEndedNotice from "./SessionEndedNotice";
import SuggestedFriendsSection from "./SuggestedFriendsSection";
import { buttonClass } from "../lib/buttonStyles";
import { apiErrorMessage } from "../lib/apiError";

/**
 * Also the 404 text from POST /api/friends -- the inline check below and that
 * route report the same fact, and submitting an unknown address reaches both.
 * Held as a constant so the duplicate can be spotted and dropped at render.
 */
const NO_PROFILE_MESSAGE = "No Venndra profile found for this email yet";

export default function NewFriendForm() {
  const [email, setEmail] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{ exists: boolean; name: string | null } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kept apart from `error` because this one renders a link rather than a
  // sentence, and it's the only failure the user can actually act on.
  const [sessionEnded, setSessionEnded] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setCheckResult(null);
      return;
    }
    setChecking(true);

    // Cancels the actual in-flight request, not just a pending timeout.
    // clearTimeout alone only stops a check that hasn't fired YET -- once the
    // 400ms elapses and fetch() is dispatched, a further keystroke's cleanup
    // could previously do nothing about it. That let two checks be in flight
    // at once (one for a typo, one for the correction typed right after it),
    // and whichever response landed last won regardless of which address was
    // still on screen: a corrected, valid address could be left showing the
    // stale "no profile found" hint from the typo it replaced, if the server
    // happened to answer the typo's request second. Aborting here means the
    // superseded request can never call setCheckResult at all.
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/friends/check?email=${encodeURIComponent(email.trim())}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (!controller.signal.aborted) setCheckResult(data);
      } catch {
        // Includes the abort itself: cancelling here throws, and that's the
        // expected way this branch is reached, not a failure to report. A
        // genuine network error also lands here and is left silent for the
        // same reason -- this hint is advisory, and POST /api/friends
        // re-validates for real regardless of what it says.
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
    }, 400);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [email]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSessionEnded(false);
    const res = await fetch("/api/friends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    });
    setSubmitting(false);
    if (!res.ok) {
      // The page guards on a session, so a 401 here means it ended underneath
      // an open tab -- signed out in another tab, or the row deleted.
      if (res.status === 401) {
        setSessionEnded(true);
        return;
      }
      // lib/apiError carries the .catch and the typeof guard, and the note
      // on why both are load-bearing -- this handler is where the missing
      // .catch was first found.
      setError(await apiErrorMessage(res, "Couldn't send that request."));
      return;
    }
    setSuccess(true);
    setEmail("");
    setCheckResult(null);
    setTimeout(() => setSuccess(false), 2000);
  }

  // The API's 404 and the inline check say the same sentence, and submitting an
  // address the check already rejected produces both at once -- the same words
  // in grey above the button and red below it. The red one is the response to
  // what was just pressed, so it's the one that stays.
  const showInlineMissing = !checking && checkResult && !checkResult.exists && error !== NO_PROFILE_MESSAGE;

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
        {showInlineMissing && <p className="text-xs text-ink/40">{NO_PROFILE_MESSAGE}</p>}

        {error && <p className="text-sm text-red-600">{error}</p>}
        {sessionEnded && <SessionEndedNotice action="send this request" />}
        {success && <p className="text-sm text-teal">Request sent!</p>}

        <button
          type="submit"
          disabled={submitting || success}
          className={buttonClass({ variant: "primary", size: "lg", className: "mt-2 w-fit" })}
        >
          {submitting ? "Sending…" : "Send request"}
        </button>
      </form>

      <SuggestedFriendsSection />
    </main>
  );
}
