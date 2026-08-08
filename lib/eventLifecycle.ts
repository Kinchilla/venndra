/**
 * Prisma `where` fragment for confirmed events that HAVEN'T happened yet.
 *
 * "Past" isn't a status -- the schema only has SEARCHING / CONFIRMED /
 * CANCELLED, and the events page derives past-ness as
 * `status === "CONFIRMED" && confirmedEnd < now` (app/events/page.tsx). So a
 * plain `status: "CONFIRMED"` query silently sweeps up every event that ever
 * happened, which is almost never what calling code means.
 *
 * This matters for the disconnect guard in particular: it blocks removing a
 * calendar that's holding confirmed events, because Cancel / Reschedule /
 * Leave all need that calendar's credentials to reach the real upstream
 * event. But every one of those actions is gated on `!event.isPast` in
 * EventChip, and the only thing still offered on a past event is Delete,
 * which by its own route's contract never touches calendars at all. A past
 * event therefore has no further need of the credentials, and blocking on one
 * would mean a calendar could become permanently undetachable simply by
 * having been used -- with the only escape being to delete real history.
 *
 * The null case mirrors isPast exactly: `confirmedEnd === null` is NOT past
 * there, so it counts as upcoming here. That's also the conservative
 * direction for a guard -- an event in a state we can't date is treated as
 * live rather than waved through.
 */
export function upcomingConfirmedWhere(now: Date = new Date()) {
  return {
    status: "CONFIRMED" as const,
    OR: [{ confirmedEnd: null }, { confirmedEnd: { gte: now } }],
  };
}
