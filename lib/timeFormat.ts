/**
 * How Venndra writes a time, and the 12h/24h choice behind it (#30).
 *
 * The preference existed before this file, but only half the app knew about
 * it. EventResults owned the storage key, the default detection and the
 * segmented control, and threaded the answer through `hour12`. EventChip
 * called toLocaleTimeString with no `hour12` at all, so it silently used
 * whatever the browser's locale defaults to.
 *
 * The result was visible: the SAME confirmed event rendered in the chosen
 * clock on /events/[id] and in the browser default on /events. One concept,
 * two implementations, disagreeing -- and disagreeing quietly, since each
 * screen looked internally consistent and you had to hold both in your head
 * to notice.
 *
 * Deliberately plain functions with no React in them, so this can be imported
 * from anywhere. The stateful half -- reading the preference on mount without
 * breaking hydration -- is hooks/useTimeFormat, which is where it has to live
 * and is also the only part any component should need.
 */

export type TimeFormat = "12h" | "24h";

/**
 * Where the choice is remembered. localStorage rather than the User row on
 * purpose: this is a rendering preference belonging to the device you are
 * reading on, not a fact about the account. Somebody on a 24h desk machine and
 * a 12h phone is expressing two correct preferences, not a conflict to
 * reconcile.
 */
export const TIME_FORMAT_STORAGE_KEY = "venndra-time-format";

/**
 * The user's saved choice, or -- until they have made one -- whatever their
 * system already uses.
 *
 * Intl's hourCycle is the standard way to read that, and it is the same
 * underlying signal the browser uses to decide how native date/time inputs
 * (like the ones on the event-creation page) present themselves, so this keeps
 * those consistent with the rest of the app without anyone having to think
 * about it.
 *
 * BROWSER ONLY. Returns the 12h default on the server, which is what makes it
 * safe to call from a first render -- see hooks/useTimeFormat for why that
 * matters and why nothing should call this during one.
 */
export function detectTimeFormat(): TimeFormat {
  if (typeof window === "undefined") return "12h";

  const saved = window.localStorage.getItem(TIME_FORMAT_STORAGE_KEY);
  if (saved === "12h" || saved === "24h") return saved;

  const hourCycle = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle;
  return hourCycle === "h23" || hourCycle === "h24" ? "24h" : "12h";
}

/** Remembers an explicit choice across visits. No-op outside a browser. */
export function saveTimeFormat(format: TimeFormat): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TIME_FORMAT_STORAGE_KEY, format);
  } catch {
    // Private-browsing modes and storage quotas can both throw. Failing to
    // remember a display preference is not worth breaking the click that set
    // it -- the choice still applies for this visit, it just won't survive.
  }
}

/**
 * A time of day, in the user's chosen clock.
 *
 * `hour12` is passed explicitly rather than left to the locale, which is the
 * whole point: leaving it out is what made EventChip ignore the preference.
 */
export function formatTime(iso: string, format: TimeFormat): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: format === "12h",
  });
}

/**
 * A date with its weekday, as slot rows and event chips both show it --
 * "Thu, Sep 3".
 *
 * Not every date in the app: the confirmed-event banner in EventResults spells
 * weekday and month out in full, and EventChip's search-range summary drops
 * the weekday entirely. Those are single-caller formats making a deliberate
 * point about emphasis, and folding them in here would be inventing a shared
 * concept where there is only a shared shape.
 */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
