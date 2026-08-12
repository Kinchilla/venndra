"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import Button from "./Button";

/**
 * The two ways out, at the bottom of /settings.
 *
 * They're penned together because they're the only controls on the page whose
 * consequences reach other people -- but they are NOT the same weight, and
 * only ONE of them is allowed to say so.
 *
 * The section is neutral throughout: a plain white card with the site's
 * ordinary border, an ink heading, and the same "Account management" name any
 * settings page would use. It was briefly a red box under a "Danger zone"
 * heading, and both were wrong for the same reason -- they painted pausing as
 * dangerous, when it's a setting you might switch on for a fortnight and off
 * again, no more alarming than a timezone. Colouring the whole container also
 * spends the page's only red on the container rather than on the one control
 * that has earned it.
 *
 * So the weight lives entirely in the buttons. Pausing wears the `edit`
 * variant, the same teal outline as every other reversible change on the
 * site, because that's exactly what it is: one click out, one click back.
 * Only deleting gets `danger`, and only deleting asks first. See lib/pause.ts
 * for how little pausing actually changes.
 */
export default function AccountManagement({
  initialPaused,
  upcomingOrganizedCount,
}: {
  initialPaused: boolean;
  /** Upcoming events this user organizes -- named in the delete dialog, since deleting cancels every one of them. */
  upcomingOrganizedCount: number;
}) {
  const router = useRouter();
  const [paused, setPaused] = useState(initialPaused);
  const [pending, setPending] = useState<"pause" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function togglePause() {
    const next = !paused;
    setPending("pause");
    setError(null);

    const res = await fetch("/api/me/pause", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused: next }),
    });
    setPending(null);

    if (!res.ok) {
      setError(next ? "Couldn't pause your account. Try again." : "Couldn't unpause your account. Try again.");
      return;
    }

    setPaused(next);
    // Nothing else on this page reads the pause state today, but /friends and
    // the event form do -- refreshing drops the Router Cache entries that
    // would otherwise show a stale answer on the way back.
    router.refresh();
  }

  /**
   * Spells out the specific consequences for THIS account rather than
   * hedging, same as the disconnect dialog in ConnectedAccountsSection: the
   * count of events about to be cancelled is something Venndra already
   * knows, so the person reading shouldn't have to work it out or discover
   * it afterwards.
   */
  function deleteConfirmText() {
    const organizing =
      upcomingOrganizedCount > 0
        ? ` The ${upcomingOrganizedCount} upcoming event${
            upcomingOrganizedCount === 1 ? "" : "s"
          } you're organizing will be cancelled, and everyone invited will get a cancellation from their own calendar.`
        : "";

    return (
      "Delete your Venndra account? This cannot be undone.\n\n" +
      "You'll be removed from every event you've joined, from your friends' lists, and from any groups you're in." +
      organizing +
      "\n\nYour connected Google, Microsoft and iCloud accounts are released -- Venndra forgets them entirely, and you're free to start a new account with any of them later."
    );
  }

  async function handleDelete() {
    setPending("delete");
    setError(null);

    const res = await fetch("/api/me", { method: "DELETE" });
    if (!res.ok) {
      setPending(null);
      setError("Couldn't delete your account. Try again, or get in touch if this keeps happening.");
      return;
    }

    // Deliberately no setPending(null) on success: the account is gone and
    // the sign-out redirect is already on its way, so re-enabling the button
    // would only offer a second DELETE against a session that no longer has
    // a user behind it.
    signOut({ callbackUrl: "/" });
  }

  return (
    <section className="mt-10">
      {/* White on the page's paper background, so it still reads as its own
          demarcated area without a colour that makes a claim. Same border and
          fill as the friend/event chips elsewhere; rounded-2xl rather than
          their rounded-xl because this holds several rows rather than one
          line, and the softer corner suits an area over an item. */}
      <div className="rounded-2xl border border-line bg-white px-5 py-5">
        <h2 className="font-display text-lg font-semibold">Account management</h2>

        {/* Keeps its red -- an error genuinely is one, and now that the card
            around it is white this needs its own fill to separate from it. */}
        {error && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-md">
            <div className="text-sm font-medium">{paused ? "Your account is paused" : "Pause my account"}</div>
            <p className="mt-0.5 text-sm text-ink/60">
              {paused
                ? "Nobody can add you to new events while you're paused. Unpause whenever you like — nothing else about your account has changed."
                : "Nobody will be able to add you to new events. Events you're already on carry on as normal; if you want out of one of those, leave it yourself."}
            </p>
          </div>
          <Button variant="edit" onClick={togglePause} disabled={pending !== null} className="shrink-0">
            {pending === "pause"
              ? paused
                ? "Unpausing…"
                : "Pausing…"
              : paused
                ? "Unpause my account"
                : "Pause my account"}
          </Button>
        </div>

        <div className="mt-5 border-t border-line pt-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 max-w-md">
              <div className="text-sm font-medium">Delete my account</div>
              <p className="mt-0.5 text-sm text-ink/60">
                Removes you from Venndra for good — every event, friends list and group you&apos;re part of, and any
                connected calendar accounts. This can&apos;t be undone.
              </p>
            </div>
            <Button
              variant="danger"
              confirm={deleteConfirmText}
              onClick={handleDelete}
              disabled={pending !== null}
              className="shrink-0"
            >
              {pending === "delete" ? "Deleting…" : "Delete my account"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
