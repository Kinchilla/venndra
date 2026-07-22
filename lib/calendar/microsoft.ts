import { Client } from "@microsoft/microsoft-graph-client";
import { prisma } from "../prisma";
import type { BusyInterval, CalendarListing } from "./google";

async function getValidAccessToken(accountId: string): Promise<string> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account?.access_token) throw new Error("Microsoft account not connected");

  const isExpired = account.expires_at ? account.expires_at * 1000 < Date.now() + 60_000 : false;
  if (!isExpired) return account.access_token;

  const tenant = process.env.MICROSOFT_TENANT_ID ?? "common";
  const resp = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: account.refresh_token!,
      scope: "openid email profile offline_access Calendars.ReadWrite",
    }),
  });

  const tokens = await resp.json();
  if (!resp.ok) throw new Error(`Microsoft token refresh failed: ${JSON.stringify(tokens)}`);

  await prisma.account.update({
    where: { id: accountId },
    data: {
      access_token: tokens.access_token,
      expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in,
      refresh_token: tokens.refresh_token ?? account.refresh_token,
    },
  });

  return tokens.access_token;
}

async function getGraphClient(accountId: string) {
  const token = await getValidAccessToken(accountId);
  return Client.init({ authProvider: (done) => done(null, token) });
}

/** Lists every calendar visible in this Microsoft account (default, shared, holidays, etc). */
export async function listMicrosoftCalendars(accountId: string): Promise<CalendarListing[]> {
  const client = await getGraphClient(accountId);
  const res = await client.api("/me/calendars").get();
  return (res.value ?? []).map((c: any) => ({
    externalId: c.id,
    label: c.name,
    isPrimary: c.isDefaultCalendar === true,
  }));
}

/**
 * Returns busy intervals across the given set of calendars, using
 * calendarView (rather than getSchedule) because getSchedule only works
 * against the account's default mailbox calendar and can't be scoped to a
 * specific subset of a user's own calendars. calendarView conveniently
 * exposes `showAs` per event, which already distinguishes tentative.
 */
export async function getMicrosoftBusyIntervals(
  accountId: string,
  calendarIds: string[],
  timeMin: Date,
  timeMax: Date
): Promise<BusyInterval[]> {
  const client = await getGraphClient(accountId);

  const results = await Promise.all(
    calendarIds.map(async (calendarId) => {
      try {
        const res = await client
          .api(`/me/calendars/${calendarId}/calendarView`)
          .query({ startDateTime: timeMin.toISOString(), endDateTime: timeMax.toISOString() })
          .header("Prefer", 'outlook.timezone="UTC"')
          .top(250)
          .get();

        return (res.value ?? [])
          .filter((e: any) => e.showAs === "busy" || e.showAs === "tentative" || e.showAs === "oof")
          .map((e: any) => ({
            start: new Date(e.start.dateTime + "Z"),
            end: new Date(e.end.dateTime + "Z"),
            tentative: e.showAs === "tentative",
          }));
      } catch (err) {
        console.error(`Failed to read Microsoft calendar ${calendarId}:`, err);
        return [];
      }
    })
  );

  return results.flat();
}

/** Creates an event on a specific calendar in this account and invites the given attendees. */
export async function createMicrosoftEvent(
  accountId: string,
  calendarId: string,
  opts: { title: string; description?: string; location?: string; start: Date; end: Date; attendeeEmails: string[] }
): Promise<string> {
  const client = await getGraphClient(accountId);

  const res = await client.api(`/me/calendars/${calendarId}/events`).post({
    subject: opts.title,
    body: { contentType: "text", content: opts.description ?? "" },
    location: opts.location ? { displayName: opts.location } : undefined,
    start: { dateTime: opts.start.toISOString(), timeZone: "UTC" },
    end: { dateTime: opts.end.toISOString(), timeZone: "UTC" },
    attendees: opts.attendeeEmails.map((email) => ({ emailAddress: { address: email }, type: "required" })),
  });

  return res.id;
}

/**
 * Moves an existing event to a new time. Graph event ids are unique across
 * the whole mailbox, so /me/events/{id} works regardless of which calendar
 * it lives on -- no need to re-specify calendarId here.
 */
export async function updateMicrosoftEventTime(
  accountId: string,
  eventId: string,
  opts: { start: Date; end: Date }
): Promise<void> {
  const client = await getGraphClient(accountId);
  await client.api(`/me/events/${eventId}`).patch({
    start: { dateTime: opts.start.toISOString(), timeZone: "UTC" },
    end: { dateTime: opts.end.toISOString(), timeZone: "UTC" },
  });
}

/** Cancels the event; Graph automatically emails every attendee a cancellation notice. */
export async function deleteMicrosoftEvent(accountId: string, eventId: string): Promise<void> {
  const client = await getGraphClient(accountId);
  await client.api(`/me/events/${eventId}`).delete();
}
