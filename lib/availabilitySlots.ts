import { addDays, addMinutes } from "date-fns";
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

  // Which calendar day is this, to the person who picked it?
  //
  // searchStart is stored as midnight in the creator's timezone expressed as a
  // UTC instant (app/api/events/route.ts), so the only way back to the date
  // they actually chose is through that timezone. This used to read the day
  // straight off the instant with startOfDay/getDay, which are server-local,
  // and that quietly worked only for creators at or west of UTC. For anyone
  // east of it the stored instant falls on the previous UTC date: a creator in
  // Tokyo picking Thursday 3 September stores 2 September 15:00Z, the day key
  // came out "wed", and a Thursday-only filter produced no slots at all.
  //
  // Everything below is deliberately UTC-anchored. The labels come from
  // formatInTimeZone, which reads a real instant through a timezone without
  // going via a Date whose local fields have been shifted to fake it -- that
  // trick is the usual way to do this and it breaks on the two days a year
  // when the shifted value lands on a time the SERVER's own timezone skips.
  // Anchoring each day at 12:00Z and stepping in UTC keeps the arithmetic away
  // from every DST boundary, in both timezones, permanently.
  const startLabel = formatInTimeZone(searchStart, creatorTimezone, "yyyy-MM-dd");
  const endLabel = formatInTimeZone(searchEnd, creatorTimezone, "yyyy-MM-dd");
  const firstDay = new Date(`${startLabel}T12:00:00Z`);
  const lastDay = new Date(`${endLabel}T12:00:00Z`);

  const MS_PER_DAY = 86_400_000;
  const totalDays = Math.max(0, Math.round((lastDay.getTime() - firstDay.getTime()) / MS_PER_DAY) + 1);

  for (let dayOffset = 0; dayOffset < totalDays; dayOffset++) {
    const day = addDays(firstDay, dayOffset);
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
