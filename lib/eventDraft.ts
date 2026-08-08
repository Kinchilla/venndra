/**
 * Marks a return trip to /events/new as one that should bring back the
 * in-progress form, rather than starting fresh.
 *
 * The new-event form saves itself to sessionStorage on every keystroke, and it
 * used to restore that draft on ANY arrival. That made the form feel haunted:
 * open it a week's worth of abandoned attempts later, or just click through the
 * header and back, and yesterday's half-finished event was sitting there. The
 * draft is still written continuously -- that part is cheap and is what makes
 * the data available at all -- but restoring it now requires someone to have
 * said so first.
 *
 * Only one flow says so today: saving a group that was started from the event
 * form, which returns the user to the event they were part-way through. If more
 * round trips appear later, they mark themselves the same way rather than the
 * form guessing from navigation.
 *
 * sessionStorage rather than a query param for the same reason as the group
 * handoff: it's a private hint between two pages, not something that belongs in
 * a shareable URL or browser history.
 */

const KEY = "venndra:restore-event-draft";

/** Where the new-event form persists itself. Exported so the read helper below and the form can't drift apart. */
export const EVENT_DRAFT_KEY = "venndra-new-event-draft";

/**
 * Reads the stored draft, but only returns it if there's something in it worth
 * offering to restore.
 *
 * The form writes a draft as soon as it renders, and by then it already holds
 * the organiser's own email and a default date range. Offering to restore THAT
 * would be offering to restore a blank form -- a prompt that appears every
 * visit and never means anything. "Substantive" is therefore something the user
 * must have actually done: named the event, described it, given it a location,
 * or added a second person.
 */
export function readSubstantiveEventDraft(): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(EVENT_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft || typeof draft !== "object") return null;

    const hasText = ["title", "description", "location"].some(
      (k) => typeof draft[k] === "string" && draft[k].trim() !== ""
    );
    const hasOthers = Array.isArray(draft.emails) && draft.emails.length > 1;

    return hasText || hasOthers ? draft : null;
  } catch {
    return null;
  }
}

/** Call immediately before navigating to /events/new when the draft should come back. */
export function markEventDraftForRestore() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, "1");
  } catch {
    // Private-browsing and quota errors: losing a restore hint is not worth
    // breaking the navigation that was about to happen.
  }
}

/**
 * Non-destructive read, so it's safe from a render (including React's
 * double-invoked StrictMode renders, where consuming here would leave the
 * second pass seeing nothing).
 */
export function hasEventDraftRestoreFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Consume the flag, so a single mark can't restore twice. Safe to call repeatedly. */
export function clearEventDraftRestoreFlag() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to do -- worst case the next visit restores once more.
  }
}
