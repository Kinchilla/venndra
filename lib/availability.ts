import { addDays, addMinutes, startOfDay, endOfDay, differenceInCalendarDays } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { prisma } from "./prisma";
import { getGoogleBusyIntervals } from "./calendar/google";
import { getMicrosoftBusyIntervals } from "./calendar/microsoft";
import { getAppleBusyIntervals } from "./calendar/apple";
import type { BusyInterval } from "./calendar/google";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
type WeeklyHours = Record<string, [string, string][]>;

export type ParticipantAvailability = {
  email: string;
  name: string | null; // null if they haven't connected an account under this email yet
  status: "free" | "tentative" | "busy" | "unknown"; // "unknown" = hasn't connected a calendar yet
};

export type Slot = {
  start: Date;
  end: Date;
  availableCount: number; // free + tentative, excludes busy and unknown
  totalConnected: number; // how many participants have a calendar connected at all
  hasTentative: boolean;
  participants: ParticipantAvailability[];
};

function overlaps(aStart: Date, aEnd: Date, b: BusyInterval): boolean {
  return aStart < b.end && b.start < aEnd;
}

/** Fetches merged busy intervals across every calendar a user has opted in for availability checking. */
async function getUserBusyIntervals(userId: string, from: Date, to: Date): Promise<BusyInterval[]> {
  const connectedCalendars = await prisma.connectedCalendar.findMany({
    where: { userId, isEnabled: true },
    include: { sources: { where: { checkAvailability: true } } },
  });

  const results = await Promise.all(
    connectedCalendars.map(async (cal) => {
      const calendarIds = cal.sources.map((s) => s.externalId);
      if (calendarIds.length === 0) return []; // account connected but every calendar toggled off

      try {
        if (cal.provider === "GOOGLE" && cal.nextAuthAccountId) {
          return await getGoogleBusyIntervals(cal.nextAuthAccountId, calendarIds, from, to);
        }
        if (cal.provider === "MICROSOFT" && cal.nextAuthAccountId) {
          return await getMicrosoftBusyIntervals(cal.nextAuthAccountId, calendarIds, from, to);
        }
        if (cal.provider === "APPLE_CALDAV") {
          return await getAppleBusyIntervals(cal.id, calendarIds, from, to);
        }
        return [];
      } catch (err) {
        // One misbehaving account (e.g. an expired token) shouldn't take
        // down availability for the whole group -- log and skip it.
        console.error(`Failed to fetch busy intervals for connected calendar ${cal.id}:`, err);
        return [];
      }
    })
  );

  return results.flat();
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/**
 * Computes candidate meeting slots for an Event by intersecting the search
 * filters (day/time windows, in the creator's timezone) against every
 * connected participant's merged busy intervals. Slots are NOT pre-filtered
 * by minAttendees here -- that's applied by the caller so the raw headcount
 * data is still available if the threshold needs to change later.
 */
export async function computeGroupAvailability(params: {
  creatorTimezone: string;
  filters: WeeklyHours;
  durationMin: number;
  searchStart: Date;
  searchEnd: Date;
  participants: { email: string; name: string | null; userId: string | null; status: "INVITED" | "CONNECTED" }[];
}): Promise<Slot[]> {
  const { creatorTimezone, filters, durationMin, searchStart, searchEnd, participants } = params;

  const now = new Date();
  const windowStart = now;
  const windowEnd = endOfDay(searchEnd);

  const connected = participants.filter((p) => p.status === "CONNECTED" && p.userId);

  const busyByEmail = new Map<string, BusyInterval[]>();
  await Promise.all(
    connected.map(async (p) => {
      const intervals = await getUserBusyIntervals(p.userId!, windowStart, windowEnd);
      busyByEmail.set(p.email, intervals);
    })
  );

  // No day/time filters set at all means "any day, any time" -- default to
  // a sensible 8am-10pm window every day rather than literally 24/7.
  const hasAnyFilter = Object.values(filters ?? {}).some((w) => w.length > 0);
  const effectiveFilters: WeeklyHours = hasAnyFilter
    ? filters
    : Object.fromEntries(DAY_KEYS.map((d) => [d, [["08:00", "22:00"]] as [string, string][]]));

  const slots: Slot[] = [];
  const stepMin = 30; // slot granularity, independent of meeting duration

  const totalDays = Math.max(0, differenceInCalendarDays(searchEnd, searchStart) + 1);

  for (let dayOffset = 0; dayOffset < totalDays; dayOffset++) {
    const day = addDays(startOfDay(searchStart), dayOffset);
    const dayKey = DAY_KEYS[day.getDay()];
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

            const busy = busyByEmail.get(p.email) ?? [];
            const conflicts = busy.filter((b) => overlaps(slotStart, slotEnd, b));
            if (conflicts.some((c) => !c.tentative)) return { email: p.email, name: p.name, status: "busy" };
            if (conflicts.some((c) => c.tentative)) return { email: p.email, name: p.name, status: "tentative" };
            return { email: p.email, name: p.name, status: "free" };
          });

          const availableCount = participantStatuses.filter(
            (p) => p.status === "free" || p.status === "tentative"
          ).length;

          slots.push({
            start: slotStart,
            end: slotEnd,
            availableCount,
            totalConnected: connected.length,
            hasTentative: participantStatuses.some((p) => p.status === "tentative"),
            participants: participantStatuses,
          });
        }

        cursor = addMinutes(cursor, stepMin);
      }
    }
  }

  return slots;
}
