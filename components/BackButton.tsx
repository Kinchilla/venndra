"use client";

import { useRouter } from "next/navigation";

export default function BackButton({
  fallbackHref = "/events",
  href,
}: {
  fallbackHref?: string;
  // When set, this button navigates straight there instead of doing a real
  // history-back -- used specifically for "Back" off a just-created,
  // still-SEARCHING event, which should behave like "Edit this search"
  // (redo the same search and cancel this one on resubmit) rather than a
  // generic back navigation.
  href?: string;
}) {
  const router = useRouter();

  function handleClick() {
    if (href) {
      router.push(href);
      return;
    }
    // history.length > 1 means there's at least one prior page in this tab's
    // session -- not a perfect signal (it also counts entries from outside
    // the app), but good enough to avoid stranding someone who opened a
    // page directly (e.g. from a bookmark or a shared link) with a "back"
    // button that has nothing to go back to.
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
  }

  return (
    <button
      onClick={handleClick}
      aria-label="Go back"
      className="mb-6 flex items-center gap-1.5 text-sm text-ink/50 hover:text-ink transition-colors"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Back
    </button>
  );
}
