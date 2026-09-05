import { Prisma } from "@prisma/client";
import type { NotificationTrigger } from "./triggers";

/**
 * Is this trigger's email on for a user, given their raw
 * User.notificationPrefs column?
 *
 * The map is sparse (see the schema comment on notificationPrefs): absence
 * of a key, a null column, or a malformed value all mean "on" -- only a
 * literal `false` turns a trigger off. That last case is the reason this
 * isn't a plain `!!prefs?.[trigger]`, which would read a missing key as off
 * instead of on.
 */
export function isEmailEnabled(
  prefs: Prisma.JsonValue | null | undefined,
  trigger: NotificationTrigger
): boolean {
  if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) return true;
  return (prefs as Record<string, unknown>)[trigger] !== false;
}

/**
 * Applies one toggle to a possibly-sparse prefs map, returning the new map
 * to write back.
 *
 * Enabling a trigger deletes its key rather than setting it to `true`, so
 * the map only ever grows for the triggers someone has actually turned off
 * -- keeping the "absent = on" invariant true for both directions instead of
 * just the read side.
 */
export function applyNotificationToggle(
  prefs: Prisma.JsonValue | null | undefined,
  trigger: NotificationTrigger,
  enabled: boolean
): Record<string, boolean> {
  const current =
    prefs && typeof prefs === "object" && !Array.isArray(prefs) ? { ...(prefs as Record<string, unknown>) } : {};

  if (enabled) {
    delete current[trigger];
  } else {
    current[trigger] = false;
  }

  // Values are only ever booleans, but the map above widens to `unknown`
  // while copying an arbitrary JsonValue -- narrow it back down for callers
  // (Prisma's Json input) rather than leaking `unknown` into the return type.
  return current as Record<string, boolean>;
}
