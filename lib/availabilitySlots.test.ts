import { describe, it, expect } from "vitest";
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
  // Pinned, and flagged on #42 rather than fixed here.
  //
  // Which day's windows apply is decided by `startOfDay(searchStart)` and
  // `day.getDay()`, and both are LOCAL-time operations -- local to the server
  // process, not to creatorTimezone. The window's time-of-day, meanwhile, IS
  // resolved in creatorTimezone via fromZonedTime. So the two halves of one
  // decision use two different clocks.
  //
  // The consequence is real: 2026-09-03T00:00:00Z is Thursday in UTC and
  // Wednesday in America/Denver, so this same call returns three slots on
  // Vercel and none on a laptop in Denver. That is why vitest.config.mts pins
  // TZ=UTC -- these tests assert the PRODUCTION behaviour, and without the pin
  // they would pass locally and fail in CI.
  //
  // Left alone deliberately: this change is behaviour-preserving, and #30
  // lists date/time handling as one of the things it exists to look at.
  it("derives the day key from the server's timezone, not the creator's", () => {
    const slots = run({
      searchStart: new Date("2026-09-03T00:00:00Z"),
      searchEnd: new Date("2026-09-03T00:00:00Z"),
      filters: { thu: [["09:00", "11:00"]] } as WeeklyHours,
      creatorTimezone: "Asia/Tokyo",
    });
    // Thursday under TZ=UTC, regardless of the creator being in Tokyo.
    expect(slots.length).toBeGreaterThan(0);
  });

  it("interprets window times in the creator's timezone, not UTC", () => {
    const slots = run({ creatorTimezone: "America/Denver" });
    // 09:00 in Denver (MDT, UTC-6) is 15:00 UTC.
    expect(slots[0].start.toISOString()).toBe("2026-09-03T15:00:00.000Z");
  });

  it("produces the same wall-clock time across timezones with different offsets", () => {
    const denver = run({ creatorTimezone: "America/Denver" })[0];
    const utc = run({ creatorTimezone: "UTC" })[0];
    expect(denver.start.toISOString()).not.toBe(utc.start.toISOString());
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
    // Pinned, and worth noticing: the Slot type's comment says availableCount
    // is "free + tentative", but the code counts only "free". The comment and
    // the code disagree. Recording the CODE's behaviour, per #42 -- the
    // discrepancy is flagged on the issue rather than fixed here.
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
