"use client";

import { useEffect, useState } from "react";

/**
 * Renders `fallback` on the very first pass -- both the server's render and
 * the client's initial hydration render use this exact same value, so
 * there's nothing for React to disagree about -- then swaps to the real
 * result of `compute()` right after mounting in the browser. Pass `deps` to
 * recompute later (e.g. when a prop the computation depends on changes);
 * defaults to computing once, on mount, and never again.
 *
 * Reach for this whenever a value depends on the ambient runtime/environment
 * rather than being a pure function of props -- anything Intl/locale-based
 * (Intl.DateTimeFormat, toLocaleDateString/toLocaleTimeString,
 * Intl.supportedValuesOf, ...) or the current date/time (`new Date()`
 * reflects wherever the code is actually running, not necessarily the
 * visitor). Node's server-side ICU version and default locale/timezone can
 * genuinely disagree with the browser's -- e.g. Node returning the legacy
 * IANA alias "Africa/Asmera" where a browser returns the now-canonical
 * "Africa/Asmara" for the same zone, or the server (typically UTC) and a
 * user's own evening-local timezone landing on different calendar dates for
 * "today" -- and rendering that mismatch straight into hydrated markup
 * crashes with a hydration error. This was first found (and fixed ad hoc,
 * before being generalized here) as EventChip's date-range formatting and
 * ProfileForm's timezone list; recompute needed for anything genuinely at
 * hydration risk before it becomes yet another one-off fix.
 *
 * Not needed for a value that's already gated behind its own client-only
 * source of truth -- e.g. state that starts `null` until an
 * effect-triggered fetch resolves is already safe by construction, since
 * nothing derived from it renders during the hydration-sensitive first pass.
 */
export function useClientValue<T>(compute: () => T, fallback: T, deps: React.DependencyList = []): T {
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    setValue(compute());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}
