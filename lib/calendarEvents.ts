/**
 * Broadcast on `window` whenever a calendar account is connected,
 * disconnected, or reconnected.
 *
 * The "Connected calendars" picker and the "Connected accounts" list are
 * separate sections of the settings page (with the server-rendered page
 * between them), so neither can own the other's state via props. Each holds
 * its own client-side list and re-fetches on this event, which keeps them
 * consistent without a full page reload or lifting both into one component
 * purely to share a refresh signal.
 */
export const CALENDARS_CHANGED_EVENT = "venndra:calendars-changed";

export type CalendarsChangedDetail = {
  /**
   * Set when the change was a disconnect, so listeners can drop that calendar
   * immediately instead of waiting to be told by the refetch.
   *
   * That wait is not trivial: the refetch behind this event is
   * /api/calendars?sync=1, which round-trips to Google, Microsoft and iCloud
   * for every remaining connected calendar before it answers. Several seconds
   * of an account still sitting in the picker after being disconnected reads
   * as the click not having worked.
   *
   * This is the same id space as ConnectedCalendar.id, which both the accounts
   * list and the sources panel already key their rows on.
   */
  disconnectedCalendarId?: string;
};

/** Always use this rather than constructing the event by hand -- a plain Event carries no detail, and listeners reading it would silently see undefined. */
export function dispatchCalendarsChanged(detail: CalendarsChangedDetail = {}) {
  window.dispatchEvent(new CustomEvent<CalendarsChangedDetail>(CALENDARS_CHANGED_EVENT, { detail }));
}

/** Safe read for listeners: tolerates a plain Event (no detail) so a stray dispatch can't throw. */
export function readCalendarsChanged(event: Event): CalendarsChangedDetail {
  return (event as CustomEvent<CalendarsChangedDetail>).detail ?? {};
}
