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
 * Reads a WeeklyHours back out of a Prisma `Json` column.
 *
 * Prisma types those columns as JsonValue -- "some JSON, shape unknown" --
 * because that is all the database guarantees. Every reader therefore has to
 * assert the shape, and before #30 seven of them did it in three different
 * ways: `as WeeklyHours | null` three times, `as any` four times, and
 * components/EventChip writing the shape out structurally for a third time.
 *
 * `as any` is the one worth removing. It does not assert a type, it switches
 * checking off for the whole expression -- so `(row.filters as any).mon.typo`
 * compiled fine and arrived as undefined. Same reason the session casts went
 * in commit 0ff08a6.
 *
 * DELIBERATELY NOT VALIDATION. This is the same unchecked assertion the call
 * sites were already making, in one place with the reasoning attached, and it
 * is behaviour-identical to what it replaced. Validating for real is a
 * separate decision with a separate question behind it -- what should the page
 * do when a stored window turns out to be malformed? -- and lib/searchWindowSchema
 * already has the validator for whoever answers it.
 *
 * Takes `unknown` rather than Prisma's JsonValue so this module stays free of
 * a Prisma import: two client components import from here as a value, and
 * dependencies should not travel that way even when they would be erased.
 */
export function asWeeklyHours(value: unknown): WeeklyHours | null {
  return (value as WeeklyHours | null | undefined) ?? null;
}


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
