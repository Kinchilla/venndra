/**
 * Hands a list of people from the new-event form to the new-group form, so
 * "turn these people into a group" doesn't make you retype them.
 *
 * Deliberately sessionStorage rather than a `?emails=` query param. The payload
 * is a list of real email addresses, and query strings end up in browser
 * history, server access logs, and any Referer header the page later sends --
 * none of which are places personal data should accumulate just to save a bit
 * of retyping. sessionStorage is same-tab and disappears on its own.
 *
 * The tradeoff is that opening the link in a NEW tab (middle-click, cmd-click)
 * loses the prefill, since sessionStorage is per-tab. That degrades to an empty
 * group form, which is exactly what the user would have got before this
 * existed -- an acceptable floor for a convenience feature.
 */

import type { WeeklyHours } from "../components/FiltersBuilder";

const KEY = "venndra:new-group-handoff";

export type GroupHandoff = { emails: string[]; filters: WeeklyHours };

/**
 * Written even when `emails` is empty. The stash does double duty -- it carries
 * the people across AND marks that this visit to /groups/new came from the
 * event form, which is what tells the group form to head back there on save.
 * Those two things have to travel together: keying the return trip off "were
 * there emails to carry" would strand anyone who clicked before adding anybody.
 */
export function stashGroupPrefill(emails: string[], filters: WeeklyHours) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ emails, filters } satisfies GroupHandoff));
  } catch {
    // Private-browsing modes and storage quotas can both throw here. Losing a
    // prefill is not worth breaking the navigation that was about to happen.
  }
}

/**
 * Reads and clears the stash -- it's a one-shot handoff, not persistent state.
 * Null means the user came to /groups/new some other way (nav link, bookmark,
 * reload), which is the case that should stay put after saving.
 */
export function takeGroupPrefill(): GroupHandoff | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(KEY);
    const parsed = JSON.parse(raw);
    const emails = Array.isArray(parsed?.emails)
      ? parsed.emails.filter((e: unknown): e is string => typeof e === "string")
      : [];
    const filters =
      parsed?.filters && typeof parsed.filters === "object" && !Array.isArray(parsed.filters)
        ? (parsed.filters as WeeklyHours)
        : {};
    return { emails, filters };
  } catch {
    return null;
  }
}
