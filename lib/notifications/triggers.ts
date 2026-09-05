/**
 * The canonical list of things Venndra can email someone about.
 *
 * One source for three consumers that would otherwise drift: the settings
 * checkboxes (components/NotificationSettingsForm), the read side of a
 * toggle (lib/notifications/prefs.ts), and the write side
 * (app/api/me/notifications/route.ts, which rejects any id not in this
 * list).
 *
 * Issue #7 lists eight triggers. Two are deliberately not here yet, each for
 * a real blocker rather than a preference:
 *
 *   - Calendar connection fails/needs re-auth: lib/calendar/authHealth.ts
 *     already tracks this (ConnectedCalendar.authFailedAt) but keeps it off
 *     end users on purpose -- the Google OAuth app is still in "Testing"
 *     status, so grants die roughly weekly for every connected account, and
 *     an email on that cadence would train people to ignore it. Add it once
 *     #9 verifies the app.
 *   - Limited-permission share request received: references issue #16,
 *     which doesn't exist yet. There's no event to notify on.
 *
 * Adding either later is exactly one entry in the array below, plus the
 * dispatch call site(s) issue #16/#9 themselves will need anyway.
 */

export type NotificationTrigger =
  | "friend_request_received"
  | "friend_request_accepted"
  | "added_to_event"
  | "event_confirmed"
  | "event_cancelled"
  | "participant_left_event";

export type NotificationTriggerInfo = {
  id: NotificationTrigger;
  /** Short label for the settings checkbox. */
  label: string;
  /** One line explaining exactly when this fires. */
  description: string;
};

/**
 * Order here is display order on /settings, chosen to read top-to-bottom as
 * "your friends, then your events" rather than alphabetically by id.
 */
export const NOTIFICATION_TRIGGERS: NotificationTriggerInfo[] = [
  {
    id: "friend_request_received",
    label: "Friend requests",
    description: "Someone sends you a friend request.",
  },
  {
    id: "friend_request_accepted",
    label: "Friend requests accepted",
    description: "Someone accepts a friend request you sent.",
  },
  {
    id: "added_to_event",
    label: "Added to an event",
    description: "You're invited to a new search.",
  },
  {
    id: "event_confirmed",
    label: "Event confirmed",
    description: "An organizer picks a time for an event you're on.",
  },
  {
    id: "event_cancelled",
    label: "Event cancelled",
    description: "An organizer cancels an event you're on.",
  },
  {
    id: "participant_left_event",
    label: "Someone leaves your event",
    description: "A participant leaves an event you organize.",
  },
];

/** Every valid id, for validating a PATCH body without hand-listing them twice. */
export const NOTIFICATION_TRIGGER_IDS: NotificationTrigger[] = NOTIFICATION_TRIGGERS.map((t) => t.id);
