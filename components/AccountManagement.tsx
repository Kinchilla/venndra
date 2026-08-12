"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import Button from "./Button";

/**
 * The two ways out, as the last section of /settings.
 *
 * Renders the rows only -- the <section>, heading and blurb live in
 * app/settings/page.tsx alongside every other section's, which is what makes
 * this one look like Connected accounts rather than like a special case.
 *
 * Getting there took two passes worth recording, because both were the same
 * mistake in different clothes. It began as a red box headed "Danger zone",
 * then as a neutral white card still headed by its own <h2>. The colour was
 * wrong because it painted pausing as dangerous, when pausing is a setting
 * you might switch on for a fortnight and off again, no more alarming than a
 * timezone -- and it spent the page's only red on a container rather than on
 * the one control that had earned it. The card was wrong for a quieter
 * reason: nothing else on /settings is boxed, so a box didn't read as
 * "important", it read as "bolted on afterwards".
 *
 * What's left carries the weight where it belongs, in the buttons. Pausing
 * wears the `edit` variant, the same teal outline as every other reversible
 * change on the site, because that's exactly what it is: one click out, one
 * click back. Only deleting gets `danger`, and only deleting asks first. See
 * lib/pause.ts for how little pausing actually changes.
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
    <div className="mt-3">
      {error && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {/* The same hairline-separated list Connected accounts above uses: two
          rows, each a description on the left and its button on the right,
          bounded top and bottom so the section has edges without needing a
          box. items-center rather than items-start because the buttons should
          line up with the row as a whole, not with the first line of a
          description that may wrap to three. */}
      <ul className="divide-y divide-line/60 border-y border-line/60">
        <li className="flex flex-wrap items-center justify-between gap-4 py-3">
          {/* States the account's condition rather than restating the button
              beside it -- the left of these rows names the subject and the
              right names the action, same as Connected accounts. It also
              means the paused state is legible at a glance instead of having
              to be inferred from which verb the button happens to show. */}
          <div className="min-w-0 max-w-md">
            <div className="text-sm text-ink/80">{paused ? "Your account is paused" : "Your account is active"}</div>
            <p className="mt-0.5 text-xs text-ink/40">
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
        </li>

        <li className="flex flex-wrap items-center justify-between gap-4 py-3">
          <div className="min-w-0 max-w-md">
            <div className="text-sm text-ink/80">Deleting can&apos;t be undone</div>
            <p className="mt-0.5 text-xs text-ink/40">
              Removes you from Venndra for good — every event, friends list and group you&apos;re part of, and any
              connected calendar accounts.
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
        </li>
      </ul>
    </div>
  );
}
