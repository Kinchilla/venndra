import { prisma } from "./prisma";
import { getGoogleBusyIntervals } from "./calendar/google";
import { getMicrosoftBusyIntervals } from "./calendar/microsoft";
import { getAppleBusyIntervals } from "./calendar/apple";
import type { BusyInterval } from "./calendar/google";
import { buildSlots, searchDays, type Slot, type WeeklyHours, type SlotParticipant } from "./availabilitySlots";

/**
 * The imperative shell around lib/availabilitySlots.
 *
 * Everything here talks to something outside the process -- the database, and
 * up to three calendar providers. The decision-making that used to sit at the
 * bottom of computeGroupAvailability now lives next door in buildSlots, where
 * it can be tested without any of that (issue #42).
 *
 * Re-exported below so this file's existing import surface is unchanged; the
 * one caller, app/api/events/[id]/availability, needed no edit.
 */
export type { Slot, ParticipantAvailability } from "./availabilitySlots";

/** Fetches merged busy intervals across every calendar a user has opted in for availability checking. */
async function getUserBusyIntervals(userId: string, from: Date, to: Date): Promise<{ intervals: BusyInterval[]; hasError: boolean }> {
  const connectedCalendars = await prisma.connectedCalendar.findMany({
    where: { userId, isEnabled: true },
    include: { sources: { where: { checkAvailability: true } } },
  });

  const results = await Promise.all(
    connectedCalendars.map(async (cal): Promise<{ intervals: BusyInterval[]; hasError: boolean }> => {
      const calendarIds = cal.sources.map((s) => s.externalId);
      if (calendarIds.length === 0) return { intervals: [], hasError: false };

      try {
        if (cal.provider === "GOOGLE" && cal.nextAuthAccountId) {
          return await getGoogleBusyIntervals(cal.nextAuthAccountId, calendarIds, from, to);
        }
        if (cal.provider === "MICROSOFT" && cal.nextAuthAccountId) {
          return await getMicrosoftBusyIntervals(cal.nextAuthAccountId, calendarIds, from, to);
        }
        if (cal.provider === "APPLE_CALDAV") {
          const intervals = await getAppleBusyIntervals(cal.id, calendarIds, from, to);
          return { intervals, hasError: false };
        }
        return { intervals: [], hasError: false };
      } catch (err) {
        console.error(`Failed to fetch busy intervals for connected calendar ${cal.id}:`, err);
        return { intervals: [], hasError: true };
      }
    })
  );

  return {
    intervals: results.flatMap((r) => r.intervals),
    hasError: results.some((r) => r.hasError),
  };
}

/**
 * Computes candidate meeting slots for an Event by intersecting the search
 * window's day/time filters with every connected participant's merged busy
 * intervals. Slots are NOT pre-filtered by how many people are free -- that
 * ranking is the caller's business.
 *
 * Fetches, then delegates. `now` is captured once and used for both halves,
 * so the window the busy intervals were fetched for and the cutoff that skips
 * past slots refer to the same instant rather than drifting apart by however
 * long the provider calls took.
 */
export async function computeGroupAvailability(params: {
  creatorTimezone: string;
  filters: WeeklyHours;
  durationMin: number;
  searchStart: Date;
  searchEnd: Date;
  participants: SlotParticipant[];
}): Promise<Slot[]> {
  const { participants, creatorTimezone, searchStart, searchEnd } = params;

  const now = new Date();
  const windowStart = now;

  // How far ahead to ask each provider for busy intervals: past the end of the
  // last day the search covers, IN THE CREATOR'S TIMEZONE. Comes from
  // searchDays, the same function buildSlots gets its days from, so the
  // fetched window is guaranteed to contain every slot that will be built out
  // of it.
  //
  // This was `endOfDay(searchEnd)` until #30. searchEnd is midnight in the
  // creator's timezone stored as a UTC instant, and endOfDay is server-local,
  // so one decision was being made with two clocks -- #49's mistake, in #49's
  // own file, in the half #49 didn't touch. On a UTC server it stopped
  // fetching four hours before a Denver creator's last slot and twenty before
  // a Berlin one, and a busy participant inside that gap came back FREE with
  // nothing to say otherwise.
  const { endsAt: windowEnd } = searchDays(searchStart, searchEnd, creatorTimezone);

  const connected = participants.filter((p) => p.status === "CONNECTED" && p.userId);

  const busyByEmail = new Map<string, BusyInterval[]>();
  const errorByEmail = new Map<string, boolean>();
  await Promise.all(
    connected.map(async (p) => {
      const { intervals, hasError } = await getUserBusyIntervals(p.userId!, windowStart, windowEnd);
      busyByEmail.set(p.email, intervals);
      errorByEmail.set(p.email, hasError);
    })
  );

  return buildSlots({ ...params, busyByEmail, errorByEmail, now });
}
