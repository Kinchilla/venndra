/**
 * The shape of a search window: day key -> the time-of-day ranges open on
 * that day, as ["HH:MM", "HH:MM"] pairs. Also the stored shape of
 * Event.filters, SavedGroup.defaultFilters and User.defaultSearchFilters.
 *
 * Declared here, and only here, as of 2026-08-31 (#30). It previously existed
 * twice -- in components/FiltersBuilder and again inside the availability
 * code -- with lib/searchWindow and lib/groupPrefill both importing the
 * component's copy. Two identical declarations that must agree, with nothing
 * making them agree, and a dependency pointing from lib into components,
 * which is backwards: the UI builds one of these, but the shape is a property
 * of the data, not of the form that edits it.
 */
export type WeeklyHours = Record<string, [string, string][]>;


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
