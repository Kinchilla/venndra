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
