import { z } from "zod";
import type { WeeklyHours } from "./searchWindow";

/**
 * Request-body validation for a search window, declared once (#30).
 *
 * `WeeklyHours` got down to a single declaration in commit 1670114, but its
 * runtime twin did not: the same
 * `z.record(z.array(z.tuple([z.string(), z.string()])))` was written out four
 * times -- as `filters` on the new-event body, `defaultFilters` on both saved-
 * group bodies, and `defaultSearchFilters` on the profile body. A type and a
 * validator for one shape are the same fact stated twice over, and four copies
 * of the second half can drift from each other and from the first.
 *
 * WHY THIS IS A SEPARATE FILE FROM lib/searchWindow.ts, which is where the type
 * lives and where this would otherwise belong: zod is server-only in this
 * project, and components/NewEventForm and components/GroupForm both import
 * `hasSearchWindow` from lib/searchWindow as a VALUE. An import is
 * all-or-nothing, so putting zod in that module would ship it to the browser
 * for two components that never validate anything. Splitting the file keeps
 * the client bundle as it was -- the same reasoning that put buildSlots in its
 * own file in #42. Don't merge them.
 *
 * `satisfies` is what stops the two halves drifting: if this validator ever
 * stops describing WeeklyHours, that line fails to compile.
 */
export const weeklyHoursSchema = z.record(
  z.array(z.tuple([z.string(), z.string()]))
) satisfies z.ZodType<WeeklyHours>;
