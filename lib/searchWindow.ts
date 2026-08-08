import type { WeeklyHours } from "../components/FiltersBuilder";

/**
 * Does this saved-group filter set actually express a search window?
 *
 * Both null and `{}` mean "no window of its own" -- `{}` is what
 * FiltersBuilder produces when nothing is selected, and it's what groups saved
 * before the "Custom search window" toggle existed stored when the user left
 * the picker untouched. Treating them the same matters at the point of USE:
 * `{}` is truthy, so a plain `if (group.defaultFilters)` would happily apply an
 * empty window and silently wipe whatever the user had already set on the
 * event form -- the exact opposite of "this group has no opinion about times".
 */
export function hasSearchWindow(filters: WeeklyHours | null | undefined): filters is WeeklyHours {
  return !!filters && Object.keys(filters).length > 0;
}
