import { addMinutes } from "date-fns";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import type { BusyInterval } from "./calendar/google";
import type { WeeklyHours } from "./searchWindow";

/**
 * The pure half of availability: given everyone's busy intervals, work out
 * which slots exist and who is free in each. No database, no calendar
 * providers, no clock -- every input arrives as an argument.
 *
 * Split out of lib/availability.ts under issue #42, which wanted to pin this
 * logic with tests before #30's refactor moves it, and couldn't: the module
 * exported exactly one function, and that function was async and imported
 * prisma plus all three calendar providers. The edge cases worth testing
 * (window boundaries, tentative-vs-busy precedence, timezone-shifted day
 * keys) were real but unreachable without mocking four dependencies.
 *
 * A separate FILE rather than just a separate function, because an import is
 * all-or-nothing: a test importing a pure function out of availability.ts
 * would still load prisma and three calendar SDKs at runtime. Only the type
 * import below crosses back, and type imports are erased at compile time, so
 * nothing here pulls in a provider.
 *
 * The pattern has a name -- functional core, imperative shell. The decisions
 * live here where they can be tested cheaply; the I/O stays next door in a
 * thin wrapper that fetches and delegates.
 */

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

// Re-exported so this module's callers need only one import. Declared in
// lib/searchWindow -- see the note there.
export type { WeeklyHours } from "./searchWindow";

export type ParticipantAvailability = {
  email: string;
  name: string | null; // null if they haven't connected an account under this email yet
  status: "free" | "tentative" | "busy" | "unknown" | "error"; // "unknown" = hasn't connected a calendar yet; "error" = couldn't read their calendar (e.g. an expired token)
};

export type Slot = {
  start: Date;
  end: Date;
  /**
   * How many participants are FREE -- tentative, busy, unknown and error all
   * excluded.
   *
   * This said "free + tentative" until 2026-08-31 and the code never did that.
   * The code is what is right: every use of this number is labelled "free" to
   * the person reading it -- "3/5 free" in EventResults, "2+ people free" on
   * EventChip -- and app/api/events/[id]/availability filters on
   * `availableCount >= minAttendees` to honour the organiser's "at least N
   * free". Counting a tentative person here would make all three overstate.
   */
  availableCount: number;
  totalConnected: number; // how many participants have a calendar connected at all
  participants: ParticipantAvailability[];
};

export type SlotParticipant = {
  email: string;
  name: string | null;
  userId: string | null;
  status: "INVITED" | "CONNECTED";
};

function overlaps(aStart: Date, aEnd: Date, b: BusyInterval): boolean {
  return aStart < b.end && b.start < aEnd;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

const MS_PER_DAY = 86_400_000;

/**
 * Which calendar days does this search cover, to the person who chose them --
 * and when is the last of them over?
 *
 * searchStart and searchEnd are stored as midnight in the creator's timezone
 * expressed as UTC instants (app/api/events/route.ts), so the only way back to
 * the dates they actually picked is through that timezone. Reading the day
 * straight off the instant is server-local, and quietly works only for
 * creators at or west of UTC: for anyone east of it the stored instant falls
 * on the previous UTC date. A creator in Tokyo picking Thursday 3 September
 * stores 2 September 15:00Z, and a Thursday-only filter then produced no slots
 * at all. That was #49.
 *
 * DECLARED ONCE, AND USED BY BOTH HALVES, which is the point (#30). buildSlots
 * needs the days; lib/availability needs `endsAt`, to know how far ahead to
 * ask each provider for busy intervals. Those are one question, and answering
 * it twice is what went wrong the first time: lib/availability derived its
 * fetch ceiling with date-fns' endOfDay -- server-local, the same mistake in
 * the same shape -- so on the last day of a search, busy events past the
 * server's midnight were never fetched and everybody looked FREE. On a UTC
 * server that lost the last four hours of a Denver day and twenty of a Berlin
 * one. #49 fixed the day keys and left this half, because the two were derived
 * separately. They no longer are.
 *
 * Everything below is UTC-anchored on purpose. The labels come from
 * formatInTimeZone, which reads a real instant through a timezone directly
 * rather than shifting a Date's local fields to fake it -- that trick is the
 * usual way to do this and it breaks on the two days a year when the shifted
 * value lands on a wall-clock time the SERVER's own timezone skips. Each day
 * is anchored at 12:00Z and stepped by exactly 86,400,000ms, which keeps the
 * arithmetic away from every DST boundary in both zones, permanently.
 *
 * `endsAt` is the noon anchor of the day AFTER the last one. That is a ceiling
 * rather than an exact end-of-day, and deliberately: UTC offsets run from -12
 * to +14, so the last day ends somewhere between dayT10:00Z and
 * (day+1)T12:00Z, and (day+1)T12:00Z covers every one of them without any
 * local-midnight arithmetic to get wrong. Over-fetching busy intervals past
 * the last slot is free -- they overlap nothing -- whereas under-fetching by
 * an hour is the bug this exists to prevent.
 */
export function searchDays(
  searchStart: Date,
  searchEnd: Date,
  creatorTimezone: string
): { days: Date[]; endsAt: Date } {
  const startLabel = formatInTimeZone(searchStart, creatorTimezone, "yyyy-MM-dd");
  const endLabel = formatInTimeZone(searchEnd, creatorTimezone, "yyyy-MM-dd");
  const firstDay = new Date(`${startLabel}T12:00:00Z`);
  const lastDay = new Date(`${endLabel}T12:00:00Z`);

  const totalDays = Math.max(0, Math.round((lastDay.getTime() - firstDay.getTime()) / MS_PER_DAY) + 1);
  const days: Date[] = [];
  for (let i = 0; i < totalDays; i++) days.push(new Date(firstDay.getTime() + i * MS_PER_DAY));

  return { days, endsAt: new Date(lastDay.getTime() + MS_PER_DAY) };
}

/**
 * Candidate meeting slots, with each participant's status in each.
 *
 * `now` is a parameter rather than a `new Date()` call for the same reason
 * the busy intervals are: a function that reads the clock gives a different
 * answer every time it runs, which makes it untestable in exactly the way
 * that matters here -- slots starting in the past are skipped, so "what does
 * this return" would otherwise depend on when you asked. The caller passes
 * the same instant it used to fetch, so the fetch window and the skip test
 * agree rather than drifting by however long the provider calls took.
 */
export function buildSlots(params: {
  creatorTimezone: string;
  filters: WeeklyHours;
  durationMin: number;
  searchStart: Date;
  searchEnd: Date;
  participants: SlotParticipant[];
  busyByEmail: Map<string, BusyInterval[]>;
  errorByEmail: Map<string, boolean>;
  now: Date;
}): Slot[] {
  const {
    creatorTimezone,
    filters,
    durationMin,
    searchStart,
    searchEnd,
    participants,
    busyByEmail,
    errorByEmail,
    now,
  } = params;

  const connected = participants.filter((p) => p.status === "CONNECTED" && p.userId);

  // No day/time filters set at all means "any day, any time" -- default to
  // a sensible 8am-10pm window every day rather than literally 24/7.
  const hasAnyFilter = Object.values(filters ?? {}).some((w) => w.length > 0);
  const effectiveFilters: WeeklyHours = hasAnyFilter
    ? filters
    : Object.fromEntries(DAY_KEYS.map((d) => [d, [["08:00", "22:00"]] as [string, string][]]));

  const slots: Slot[] = [];
  const stepMin = 30; // slot granularity, independent of meeting duration

  // Which calendar days this covers, to the person who picked them. Derived by
  // searchDays above, not here, so the busy-interval fetch in lib/availability
  // cannot disagree with the slots this produces -- see the note there.
  const { days } = searchDays(searchStart, searchEnd, creatorTimezone);

  for (const day of days) {
    // getUTCDay, not getDay: `day` is a noon-UTC anchor standing for a date in
    // the creator's timezone, so its UTC fields are the ones that mean
    // anything. getDay would put the server back into the answer.
    const dayKey = DAY_KEYS[day.getUTCDay()];
    const windows = effectiveFilters[dayKey] ?? [];

    for (const [startStr, endStr] of windows) {
      const [sh, sm] = startStr.split(":").map(Number);
      const [eh, em] = endStr.split(":").map(Number);
      const dayLabel = day.toISOString().slice(0, 10);

      let cursor = fromZonedTime(`${dayLabel}T${pad(sh)}:${pad(sm)}:00`, creatorTimezone);
      const windowEndUtc = fromZonedTime(`${dayLabel}T${pad(eh)}:${pad(em)}:00`, creatorTimezone);

      while (addMinutes(cursor, durationMin) <= windowEndUtc) {
        const slotStart = cursor;
        const slotEnd = addMinutes(cursor, durationMin);

        if (slotStart >= now) {
          const participantStatuses: ParticipantAvailability[] = participants.map((p) => {
            if (p.status === "INVITED" || !p.userId) return { email: p.email, name: null, status: "unknown" };
            if (errorByEmail.get(p.email)) return { email: p.email, name: p.name, status: "error" };

            const busy = busyByEmail.get(p.email) ?? [];
            const conflicts = busy.filter((b) => overlaps(slotStart, slotEnd, b));
            if (conflicts.some((c) => !c.tentative)) return { email: p.email, name: p.name, status: "busy" };
            if (conflicts.some((c) => c.tentative)) return { email: p.email, name: p.name, status: "tentative" };
            return { email: p.email, name: p.name, status: "free" };
          });

          const availableCount = participantStatuses.filter((p) => p.status === "free").length;

          slots.push({
            start: slotStart,
            end: slotEnd,
            availableCount,
            totalConnected: connected.length,
            participants: participantStatuses,
          });
        }

        cursor = addMinutes(cursor, stepMin);
      }
    }
  }

  return slots;
}
