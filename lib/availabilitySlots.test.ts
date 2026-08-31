import { describe, it, expect } from "vitest";
import { fromZonedTime } from "date-fns-tz";
import { buildSlots, type SlotParticipant, type WeeklyHours } from "./availabilitySlots";
import type { BusyInterval } from "./calendar/google";

/**
 * Characterization tests for the logic #42 originally couldn't reach -- see
 * the note at the top of lib/availabilitySlots.ts for why it was unreachable
 * and what was done about it.
 *
 * Every input is fixed, including `now`, so these say the same thing in a
 * year as they do today. That is the whole point of injecting the clock.
 */

/**
 * How app/api/events/route.ts actually stores a chosen date: midnight in the
 * creator's timezone, as a UTC instant. Tests build their inputs through this
 * rather than hand-writing a "...T00:00:00Z", because the two only agree for
 * creators at or west of UTC -- which is exactly the bug this file caught.
 */
const storedDate = (isoDate: string, tz: string) => fromZonedTime(`${isoDate}T00:00:00`, tz);

// A Thursday, deliberately: enough that a wrong day-key lookup shows up as a
// missing window rather than accidentally matching.
const THURSDAY = new Date("2026-09-03T00:00:00Z");
// Well before any slot below, so nothing is skipped as "in the past" unless a
// test is specifically about that.
const LONG_AGO = new Date("2000-01-01T00:00:00Z");

const connected = (email: string, name = "Person"): SlotParticipant => ({
  email,
  name,
  userId: `user-${email}`,
  status: "CONNECTED",
});
const invited = (email: string): SlotParticipant => ({
  email,
  name: null,
  userId: null,
  status: "INVITED",
});

function run(over: Partial<Parameters<typeof buildSlots>[0]> = {}) {
  return buildSlots({
    creatorTimezone: "UTC",
    filters: { thu: [["09:00", "11:00"]] } as WeeklyHours,
    durationMin: 60,
    searchStart: THURSDAY,
    searchEnd: THURSDAY,
    participants: [connected("a@x.com")],
    busyByEmail: new Map(),
    errorByEmail: new Map(),
    now: LONG_AGO,
    ...over,
  });
}

describe("slot generation", () => {
  it("steps in 30-minute increments regardless of meeting length", () => {
    const slots = run();
    // 09:00-11:00 with a 60-min meeting: 09:00, 09:30, 10:00. 10:30 would end
    // at 11:30, past the window.
    expect(slots.map((s) => s.start.toISOString())).toEqual([
      "2026-09-03T09:00:00.000Z",
      "2026-09-03T09:30:00.000Z",
      "2026-09-03T10:00:00.000Z",
    ]);
  });

  it("includes a slot that ends exactly on the window boundary", () => {
    const slots = run({ durationMin: 120 });
    expect(slots).toHaveLength(1);
    expect(slots[0].end.toISOString()).toBe("2026-09-03T11:00:00.000Z");
  });

  it("produces nothing when the meeting is longer than the window", () => {
    expect(run({ durationMin: 121 })).toHaveLength(0);
  });

  it("produces nothing for a zero-length window", () => {
    expect(run({ filters: { thu: [["09:00", "09:00"]] } as WeeklyHours })).toHaveLength(0);
  });

  it("produces nothing when the day has no window", () => {
    expect(run({ filters: { fri: [["09:00", "11:00"]] } as WeeklyHours })).toHaveLength(0);
  });

  it("handles several windows on one day", () => {
    const slots = run({ filters: { thu: [["09:00", "10:00"], ["14:00", "15:00"]] } as WeeklyHours });
    expect(slots.map((s) => s.start.toISOString())).toEqual([
      "2026-09-03T09:00:00.000Z",
      "2026-09-03T14:00:00.000Z",
    ]);
  });

  it("defaults to 08:00-22:00 every day when no filter is set at all", () => {
    const slots = run({ filters: {} as WeeklyHours });
    expect(slots[0].start.toISOString()).toBe("2026-09-03T08:00:00.000Z");
    expect(slots[slots.length - 1].end.toISOString()).toBe("2026-09-03T22:00:00.000Z");
  });

  // A filter key present but empty is NOT "no filters" -- pinned because the
  // check is `.some(w => w.length > 0)`, so `{thu: []}` still counts as unset.
  it("treats a filter object with only empty windows as unset", () => {
    const slots = run({ filters: { thu: [] } as WeeklyHours });
    expect(slots[0].start.toISOString()).toBe("2026-09-03T08:00:00.000Z");
  });

  it("skips slots that start before now", () => {
    const slots = run({ now: new Date("2026-09-03T09:45:00Z") });
    expect(slots.map((s) => s.start.toISOString())).toEqual(["2026-09-03T10:00:00.000Z"]);
  });

  it("spans multiple days inclusively", () => {
    const slots = run({
      searchEnd: new Date("2026-09-04T00:00:00Z"),
      filters: { thu: [["09:00", "10:00"]], fri: [["09:00", "10:00"]] } as WeeklyHours,
    });
    expect(slots.map((s) => s.start.toISOString())).toEqual([
      "2026-09-03T09:00:00.000Z",
      "2026-09-04T09:00:00.000Z",
    ]);
  });
});

describe("timezones", () => {
  // These build searchStart the way the app stores it -- midnight in the
  // creator's timezone -- because the difference between that and a raw
  // "...T00:00:00Z" is precisely the bug this file caught. Feeding in the raw
  // instant is what an earlier version of these tests did, and it made a
  // Denver creator look correct while hiding that Tokyo was broken.
  const thursdayOnly = { thu: [["09:00", "11:00"]] } as WeeklyHours;
  const forCreator = (tz: string) =>
    run({
      creatorTimezone: tz,
      filters: thursdayOnly,
      searchStart: storedDate("2026-09-03", tz),
      searchEnd: storedDate("2026-09-03", tz),
    });

  it("takes the day key from the creator's timezone, not the server's", () => {
    // Tokyo's midnight-on-the-3rd is the 2nd in UTC. Reading the day off the
    // raw instant gave "wed" and dropped every slot.
    expect(forCreator("Asia/Tokyo")).toHaveLength(3);
  });

  it("interprets window times in the creator's timezone", () => {
    // 09:00 in Denver (MDT, UTC-6) is 15:00 UTC.
    expect(forCreator("America/Denver")[0].start.toISOString()).toBe("2026-09-03T15:00:00.000Z");
  });

  it("resolves one wall-clock time to different instants across offsets", () => {
    const denver = forCreator("America/Denver")[0];
    const utc = forCreator("UTC")[0];
    expect(denver.start.toISOString()).not.toBe(utc.start.toISOString());
  });

  // A DST transition inside the creator's own timezone. US DST ended on
  // 1 November 2026, so this Sunday has a 25-hour day. The window must still
  // resolve to 09:00 local, and the day arithmetic must not slip a date.
  it("survives a DST transition in the creator's timezone", () => {
    const slots = run({
      creatorTimezone: "America/Denver",
      filters: { sun: [["09:00", "11:00"]] } as WeeklyHours,
      searchStart: storedDate("2026-11-01", "America/Denver"),
      searchEnd: storedDate("2026-11-01", "America/Denver"),
    });
    expect(slots).toHaveLength(3);
    // 09:00 MST (UTC-7) after the change, not 15:00Z as it would be in MDT.
    expect(slots[0].start.toISOString()).toBe("2026-11-01T16:00:00.000Z");
  });
});

describe("participant status", () => {
  const busy = (start: string, end: string, tentative = false): BusyInterval => ({
    start: new Date(start),
    end: new Date(end),
    tentative,
  });

  it("marks a participant free when nothing conflicts", () => {
    const slots = run();
    expect(slots[0].participants).toEqual([{ email: "a@x.com", name: "Person", status: "free" }]);
  });

  it("marks a participant busy when a hard event overlaps", () => {
    const slots = run({
      busyByEmail: new Map([["a@x.com", [busy("2026-09-03T09:30:00Z", "2026-09-03T10:30:00Z")]]]),
    });
    expect(slots[0].participants[0].status).toBe("busy");
  });

  it("marks a participant tentative when only a tentative event overlaps", () => {
    const slots = run({
      busyByEmail: new Map([["a@x.com", [busy("2026-09-03T09:30:00Z", "2026-09-03T10:30:00Z", true)]]]),
    });
    expect(slots[0].participants[0].status).toBe("tentative");
  });

  it("lets a hard conflict win over a tentative one in the same slot", () => {
    const slots = run({
      busyByEmail: new Map([
        [
          "a@x.com",
          [
            busy("2026-09-03T09:00:00Z", "2026-09-03T10:00:00Z", true),
            busy("2026-09-03T09:00:00Z", "2026-09-03T10:00:00Z", false),
          ],
        ],
      ]),
    });
    expect(slots[0].participants[0].status).toBe("busy");
  });

  // Touching-but-not-overlapping. The check is strict (`aStart < b.end &&
  // b.start < aEnd`), so an event ending exactly when a slot starts does not
  // conflict -- back-to-back meetings are allowed.
  it("does not count an event that ends exactly when the slot starts", () => {
    const slots = run({
      busyByEmail: new Map([["a@x.com", [busy("2026-09-03T08:00:00Z", "2026-09-03T09:00:00Z")]]]),
    });
    expect(slots[0].participants[0].status).toBe("free");
  });

  it("does not count an event that starts exactly when the slot ends", () => {
    const slots = run({
      busyByEmail: new Map([["a@x.com", [busy("2026-09-03T10:00:00Z", "2026-09-03T11:00:00Z")]]]),
    });
    expect(slots[0].participants[0].status).toBe("free");
  });

  it("marks a participant error when their calendar couldn't be read", () => {
    const slots = run({ errorByEmail: new Map([["a@x.com", true]]) });
    expect(slots[0].participants[0].status).toBe("error");
  });

  // Precedence: an error is reported even when busy intervals also came back,
  // because a partial read is not a trustworthy "free".
  it("reports error ahead of any busy data for the same person", () => {
    const slots = run({
      busyByEmail: new Map([["a@x.com", [busy("2026-09-03T09:00:00Z", "2026-09-03T10:00:00Z")]]]),
      errorByEmail: new Map([["a@x.com", true]]),
    });
    expect(slots[0].participants[0].status).toBe("error");
  });

  it("marks invited-but-not-connected people unknown, and hides their name", () => {
    const slots = run({ participants: [invited("b@x.com")] });
    expect(slots[0].participants).toEqual([{ email: "b@x.com", name: null, status: "unknown" }]);
  });
});

describe("counts", () => {
  it("counts only free participants in availableCount, not tentative", () => {
    const slots = run({
      participants: [connected("a@x.com"), connected("b@x.com")],
      busyByEmail: new Map([
        ["b@x.com", [{ start: new Date("2026-09-03T09:00:00Z"), end: new Date("2026-09-03T10:00:00Z"), tentative: true }]],
      ]),
    });
    expect(slots[0].participants.map((p) => p.status)).toEqual(["free", "tentative"]);
    // The comment on Slot.availableCount used to say "free + tentative" while
    // the code counted only free. Resolved 2026-08-31 in favour of the code,
    // because every reader of this number is shown the word "free". This test
    // is what holds that decision in place.
    expect(slots[0].availableCount).toBe(1);
  });

  it("counts connected participants in totalConnected, excluding invited", () => {
    const slots = run({ participants: [connected("a@x.com"), invited("b@x.com")] });
    expect(slots[0].totalConnected).toBe(1);
    expect(slots[0].participants).toHaveLength(2);
  });

  it("treats a CONNECTED participant with no userId as not connected", () => {
    const slots = run({
      participants: [{ email: "c@x.com", name: "C", userId: null, status: "CONNECTED" }],
    });
    expect(slots[0].totalConnected).toBe(0);
    expect(slots[0].participants[0].status).toBe("unknown");
  });
});

describe("the creator's calendar day, east and west of UTC", () => {
  // searchStart is stored as midnight in the CREATOR's timezone, expressed as
  // a UTC instant (app/api/events/route.ts). Recovering "which calendar day
  // did they pick" therefore requires converting back through that timezone.
  //
  // These run the same Thursday-only filter for creators either side of UTC.
  // They should behave identically: both picked Thursday 3 September.
  const thursdayOnly = { thu: [["09:00", "11:00"]] } as WeeklyHours;

  function forCreator(tz: string) {
    return buildSlots({
      creatorTimezone: tz,
      filters: thursdayOnly,
      durationMin: 60,
      searchStart: storedDate("2026-09-03", tz),
      searchEnd: storedDate("2026-09-03", tz),
      participants: [connected("a@x.com")],
      busyByEmail: new Map(),
      errorByEmail: new Map(),
      now: LONG_AGO,
    });
  }

  it("finds the Thursday windows for a creator west of UTC", () => {
    expect(forCreator("America/Denver")).toHaveLength(3);
  });

  it("finds the Thursday windows for a creator at UTC", () => {
    expect(forCreator("UTC")).toHaveLength(3);
  });

  // Tokyo is UTC+9, so their midnight-3-September is 2 September 15:00Z. Any
  // day-key derived from the raw instant reads that as Wednesday and applies
  // the wrong day's windows -- or, as here, none at all.
  it("finds the Thursday windows for a creator east of UTC", () => {
    expect(forCreator("Asia/Tokyo")).toHaveLength(3);
  });

  it("puts the slots on the creator's chosen date, not a neighbouring one", () => {
    for (const tz of ["America/Denver", "UTC", "Asia/Tokyo", "Europe/Berlin", "Australia/Sydney"]) {
      const slots = forCreator(tz);
      expect(slots.length, `${tz} produced no slots`).toBeGreaterThan(0);
      // 09:00 local on the 3rd, whatever that is in UTC.
      expect(slots[0].start.toISOString(), tz).toBe(
        fromZonedTime("2026-09-03T09:00:00", tz).toISOString()
      );
    }
  });
});
