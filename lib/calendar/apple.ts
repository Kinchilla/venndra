import { randomUUID } from "crypto";
import { DAVClient } from "tsdav";
// @ts-ignore -- ical.js ships without first-class types
import ICAL from "ical.js";
import { decrypt } from "../crypto";
import { prisma } from "../prisma";
import type { BusyInterval, CalendarListing } from "./google";

/**
 * Apple/iCloud has no OAuth API for third-party calendar access. The only
 * supported path is CalDAV authenticated with an "app-specific password"
 * the user generates at appleid.apple.com. There's no freebusy endpoint
 * either, so we fetch raw events in the window and derive busy intervals
 * (with tentative status, from each VEVENT's STATUS property) ourselves.
 */
async function getDavClient(connectedCalendarId: string) {
  const cal = await prisma.connectedCalendar.findUnique({ where: { id: connectedCalendarId } });
  if (!cal?.caldavUrl || !cal.caldavUsername || !cal.caldavPasswordEncrypted) {
    throw new Error("Apple calendar not fully configured");
  }

  const client = new DAVClient({
    serverUrl: cal.caldavUrl, // typically https://caldav.icloud.com
    credentials: {
      username: cal.caldavUsername,
      password: decrypt(cal.caldavPasswordEncrypted),
    },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });

  await client.login();
  return client;
}

/** Lists every CalDAV calendar in this iCloud account (e.g. "Home", "Work", "US Holidays"). */
export async function listAppleCalendars(connectedCalendarId: string): Promise<CalendarListing[]> {
  const client = await getDavClient(connectedCalendarId);
  const calendars = await client.fetchCalendars();
  return calendars
    .filter((c) => c.url)
    .map((c) => ({ externalId: c.url, label: (c.displayName as string) || c.url, isPrimary: false }));
}

export async function getAppleBusyIntervals(
  connectedCalendarId: string,
  calendarUrls: string[],
  timeMin: Date,
  timeMax: Date
): Promise<BusyInterval[]> {
  const client = await getDavClient(connectedCalendarId);
  const allCalendars = await client.fetchCalendars();
  const calendars = allCalendars.filter((c) => calendarUrls.includes(c.url as string));

  const intervals: BusyInterval[] = [];

  for (const calendar of calendars) {
    const objects = await client.fetchCalendarObjects({
      calendar,
      timeRange: { start: timeMin.toISOString(), end: timeMax.toISOString() },
    });

    for (const obj of objects) {
      if (!obj.data) continue;
      try {
        const jcalData = ICAL.parse(obj.data);
        const comp = new ICAL.Component(jcalData);
        for (const vevent of comp.getAllSubcomponents("vevent")) {
          const event = new ICAL.Event(vevent);

          const status = (vevent.getFirstPropertyValue("status") ?? "").toString().toUpperCase();
          if (status === "CANCELLED") continue;

          // Skip events marked as "free" (transparent) -- e.g. holidays some
          // people keep on their calendar but that don't actually block time.
          const transp = vevent.getFirstPropertyValue("transp");
          if (transp === "TRANSPARENT") continue;

          intervals.push({
            start: event.startDate.toJSDate(),
            end: event.endDate.toJSDate(),
            tentative: status === "TENTATIVE",
          });
        }
      } catch {
        // Skip anything we can't parse rather than failing the whole query.
      }
    }
  }

  return intervals;
}

/**
 * Apple/iCloud write-back, v1: there is no reliable way to know whether a
 * third-party CalDAV PUT with ATTENDEE properties actually triggers real
 * iCloud invitation emails, so this deliberately does NOT attempt attendee
 * scheduling at all. It only ever writes the confirmed event onto the
 * write-target's own Apple calendar (no ATTENDEE properties), and lists
 * confirmed participants by name in the DESCRIPTION for the organizer's own
 * reference -- the UI is responsible for telling everyone the organizer has
 * to invite people manually. See the write-back scoping doc for the full
 * rationale.
 */

class AppleWriteConflictError extends Error {}

/** Builds the plain-text participant list appended to an Apple event's DESCRIPTION. */
export function buildAppleDescriptionText(
  baseDescription: string | null | undefined,
  participants: { email: string; name: string | null }[]
): string {
  const lines: string[] = [];
  if (baseDescription) lines.push(baseDescription, "");
  const names = participants.map((p) => (p.name ? `${p.name} (${p.email})` : p.email));
  lines.push(`Planned with Venndra. Attending: ${names.join(", ") || "no one yet"}.`);
  lines.push("");
  lines.push("iCloud doesn't support automatic invites through Venndra -- please invite everyone above yourself.");
  return lines.join("\n");
}

/** Builds the full VCALENDAR/VEVENT for a brand-new Apple event. No ATTENDEE/ORGANIZER properties -- see module note above. */
function buildAppleCalendarComponent(opts: {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  participants: { email: string; name: string | null }[];
}): ICAL.Component {
  const vcalendar = new ICAL.Component(["vcalendar", [], []]);
  vcalendar.updatePropertyWithValue("prodid", "-//Venndra//Apple Calendar Write-Back//EN");
  vcalendar.updatePropertyWithValue("version", "2.0");

  const vevent = new ICAL.Component("vevent");
  vevent.updatePropertyWithValue("uid", opts.uid);
  vevent.updatePropertyWithValue("dtstamp", ICAL.Time.fromJSDate(new Date(), true));
  vevent.updatePropertyWithValue("dtstart", ICAL.Time.fromJSDate(opts.start, true));
  vevent.updatePropertyWithValue("dtend", ICAL.Time.fromJSDate(opts.end, true));
  vevent.updatePropertyWithValue("sequence", 0);
  vevent.updatePropertyWithValue("status", "CONFIRMED");
  vevent.updatePropertyWithValue("transp", "OPAQUE"); // so this event correctly counts as busy time when read back by getAppleBusyIntervals
  vevent.updatePropertyWithValue("summary", opts.title);
  if (opts.location) vevent.updatePropertyWithValue("location", opts.location);
  vevent.updatePropertyWithValue("description", buildAppleDescriptionText(opts.description, opts.participants));

  vcalendar.addSubcomponent(vevent);
  return vcalendar;
}

/**
 * Creates a brand-new event on the write-target's Apple calendar.
 * `If-None-Match: *` guards against colliding with an existing resource at
 * this UID, which should be effectively impossible with a fresh UUID but
 * costs nothing to assert.
 */
export async function createAppleEvent(
  connectedCalendarId: string,
  calendarUrl: string, // CalendarSource.externalId -- the CalDAV calendar collection URL
  opts: {
    title: string;
    description?: string;
    location?: string;
    start: Date;
    end: Date;
    participants: { email: string; name: string | null }[];
  }
): Promise<{ externalEventId: string; externalEventHref: string; externalEventEtag: string | null }> {
  const client = await getDavClient(connectedCalendarId);
  const uid = randomUUID();
  const href = `${calendarUrl.replace(/\/$/, "")}/${uid}.ics`;

  const vcalendar = buildAppleCalendarComponent({ uid, ...opts });

  const res = await client.createObject({
    url: href,
    data: vcalendar.toString(),
    headers: { ...client.authHeaders, "Content-Type": "text/calendar; charset=utf-8", "If-None-Match": "*" },
  });
  if (!res.ok) throw new Error(`Failed to create Apple calendar event (${res.status})`);

  return { externalEventId: uid, externalEventHref: href, externalEventEtag: res.headers.get("etag") };
}

/** Authenticated GET of a single CalDAV resource -- used to fetch the current VEVENT before patching it. */
async function fetchAppleObjectText(client: DAVClient, href: string): Promise<string> {
  const res = await fetch(href, { headers: { ...client.authHeaders } });
  if (!res.ok) throw new Error(`Failed to fetch Apple calendar event (${res.status})`);
  return res.text();
}

async function putAppleObject(client: DAVClient, href: string, ics: string, ifMatchEtag?: string): Promise<Response> {
  const headers: Record<string, string> = { ...client.authHeaders, "Content-Type": "text/calendar; charset=utf-8" };
  if (ifMatchEtag) headers["If-Match"] = ifMatchEtag;
  return client.updateObject({ url: href, data: ics, headers });
}

/**
 * Shared "fetch the current VEVENT, apply one change, PUT it back" helper
 * used by both updateAppleEventTime and updateAppleEventDescription -- the
 * fetch/conflict-retry logic is identical between them, only what `mutate`
 * changes differs.
 *
 * The first attempt conditions its PUT on the etag Venndra last knew about
 * (`storedEtag`), so a 412 there means the resource genuinely changed
 * externally since Venndra's last write (e.g. the organizer edited it
 * directly in Apple Calendar) -- not just because we're re-fetching before
 * every write. On a 412, we re-fetch the now-current version, re-apply just
 * our change on top of it, and retry exactly once.
 *
 * CONFIRMED VIA REAL-SERVER TESTING: iCloud's CalDAV endpoint does not
 * reliably honor `If-Match: *` as "match any current state" -- a real
 * conflict retry using `If-Match: *` still came back 412 from iCloud. The
 * only unconditional write iCloud reliably accepts is one with no If-Match
 * header at all, so the retry (and the first attempt, when there's no
 * storedEtag to condition on) omits the header entirely rather than
 * sending "*".
 */
async function fetchAndPatchAppleEvent(
  connectedCalendarId: string,
  href: string,
  storedEtag: string | null,
  mutate: (vevent: ICAL.Component) => void
): Promise<{ externalEventEtag: string | null }> {
  const client = await getDavClient(connectedCalendarId);

  async function fetchApplyAndPut(ifMatchEtag?: string): Promise<Response> {
    const text = await fetchAppleObjectText(client, href);
    const comp = new ICAL.Component(ICAL.parse(text));
    const vevent = comp.getFirstSubcomponent("vevent");
    if (!vevent) throw new Error("Apple calendar event has no VEVENT to update");
    const sequence = Number(vevent.getFirstPropertyValue("sequence") ?? 0);
    vevent.updatePropertyWithValue("sequence", sequence + 1);
    mutate(vevent);
    return putAppleObject(client, href, comp.toString(), ifMatchEtag);
  }

  let res = await fetchApplyAndPut(storedEtag ?? undefined);
  if (res.status === 412) {
    res = await fetchApplyAndPut(undefined);
    if (res.status === 412) {
      throw new AppleWriteConflictError("Apple calendar event was modified elsewhere and the retry also conflicted");
    }
  }
  if (!res.ok) throw new Error(`Failed to update Apple calendar event (${res.status})`);

  return { externalEventEtag: res.headers.get("etag") };
}

/** Reschedule: re-PUTs the event with a new DTSTART/DTEND. See fetchAndPatchAppleEvent for the conflict-retry behavior. */
export async function updateAppleEventTime(
  connectedCalendarId: string,
  opts: { href: string; etag: string | null; start: Date; end: Date }
): Promise<{ externalEventEtag: string | null }> {
  return fetchAndPatchAppleEvent(connectedCalendarId, opts.href, opts.etag, (vevent) => {
    vevent.updatePropertyWithValue("dtstart", ICAL.Time.fromJSDate(opts.start, true));
    vevent.updatePropertyWithValue("dtend", ICAL.Time.fromJSDate(opts.end, true));
  });
}

/**
 * The Apple equivalent of removeGoogleAttendee/removeMicrosoftAttendee --
 * since there's no ATTENDEE list to modify, this instead re-PUTs the same
 * event with an updated DESCRIPTION participant list (built via
 * buildAppleDescriptionText by the caller). See fetchAndPatchAppleEvent for
 * the conflict-retry behavior.
 */
export async function updateAppleEventDescription(
  connectedCalendarId: string,
  opts: { href: string; etag: string | null; description: string }
): Promise<{ externalEventEtag: string | null }> {
  return fetchAndPatchAppleEvent(connectedCalendarId, opts.href, opts.etag, (vevent) => {
    vevent.updatePropertyWithValue("description", opts.description);
  });
}

/**
 * Deletes the write-target's Apple event, e.g. on Cancel or Reschedule.
 * Treats 404/410 (already gone -- e.g. deleted by hand in Apple Calendar)
 * as success rather than an error, matching the existing forgiving
 * treatment of deleteGoogleEvent/deleteMicrosoftEvent failures at the call
 * sites. On a 412 ETag conflict, retries once unconditionally -- omitting
 * If-Match entirely rather than sending "*", per the same real-server
 * finding as fetchAndPatchAppleEvent above (iCloud doesn't reliably honor
 * the wildcard).
 */
export async function deleteAppleEvent(
  connectedCalendarId: string,
  opts: { href: string; etag: string | null }
): Promise<void> {
  const client = await getDavClient(connectedCalendarId);

  const headers: Record<string, string> = { ...client.authHeaders };
  if (opts.etag) headers["If-Match"] = opts.etag;

  let res = await client.deleteObject({ url: opts.href, headers });
  if (res.status === 404 || res.status === 410) return;
  if (res.status === 412) {
    res = await client.deleteObject({ url: opts.href, headers: { ...client.authHeaders } });
    if (res.status === 404 || res.status === 410) return;
  }
  if (!res.ok) throw new Error(`Failed to delete Apple calendar event (${res.status})`);
}
