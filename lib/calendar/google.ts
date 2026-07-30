import { google } from "googleapis";
import { prisma } from "../prisma";

/**
 * Builds an authenticated Google client for a given internal Account.id,
 * refreshing the access token if needed. Google's client library handles
 * the refresh itself once handed the refresh_token; we persist whatever new
 * access_token it returns so we don't refresh on every call.
 */
async function getGoogleClient(accountId: string) {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account?.access_token) throw new Error("Google account not connected");

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token,
    expiry_date: account.expires_at ? account.expires_at * 1000 : undefined,
  });

  oauth2Client.on("tokens", async (tokens) => {
    await prisma.account.update({
      where: { id: accountId },
      data: {
        access_token: tokens.access_token ?? account.access_token,
        expires_at: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : account.expires_at,
        refresh_token: tokens.refresh_token ?? account.refresh_token,
      },
    });
  });

  return google.calendar({ version: "v3", auth: oauth2Client });
}

export type BusyInterval = { start: Date; end: Date; tentative: boolean };
export type CalendarListing = { externalId: string; label: string; isPrimary: boolean };

/** Lists every calendar visible in this Google account (personal, work, shared, holidays, etc). */
export async function listGoogleCalendars(accountId: string): Promise<CalendarListing[]> {
  const calendar = await getGoogleClient(accountId);
  const res = await calendar.calendarList.list();
  return (res.data.items ?? [])
    .filter((c) => c.id)
    .map((c) => ({
      externalId: c.id!,
      label: c.summaryOverride || c.summary || c.id!,
      // NOT "c.id === 'primary'" -- when *listing* calendars, the primary
      // one's real id is the account's own email address; "primary" is
      // only a valid shortcut in certain other API request paths, never a
      // value that shows up here. This boolean field is Google's actual
      // signal for "this is the account's main calendar."
      isPrimary: c.primary === true,
    }));
}

/**
 * Returns busy intervals across the given set of calendars in this account,
 * each flagged tentative or not. Uses events.list per calendar (rather than
 * freebusy.query) because freebusy only returns merged "busy" blocks with
 * no tentative/confirmed distinction, and because freebusy.query cannot be
 * restricted to a specific subset of a user's own calendars.
 */
export async function getGoogleBusyIntervals(
  accountId: string,
  calendarIds: string[],
  timeMin: Date,
  timeMax: Date
): Promise<{ intervals: BusyInterval[]; hasError: boolean }> {
  const calendar = await getGoogleClient(accountId);
  let hasError = false;

  const results = await Promise.all(
    calendarIds.map(async (calendarId) => {
      try {
        const res = await calendar.events.list({
          calendarId,
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: true, // expands recurring events into individual instances
          maxResults: 2500,
        });

        const intervals: BusyInterval[] = [];
        for (const event of res.data.items ?? []) {
          if (event.status === "cancelled") continue;
          if (event.transparency === "transparent") continue; // marked "free" by the user
          if (!event.start?.dateTime || !event.end?.dateTime) continue; // skip all-day events

          // If this calendar's owner is an INVITEE on the event (rather than
          // its sole owner), their own RSVP -- not the event's overall
          // status -- is what determines tentative/confirmed/doesn't-count.
          // event.status reflects the event as a whole from the organizer's
          // side; a "Maybe" response lives separately, per-attendee, in
          // attendees[].responseStatus. Checking event.status here was the
          // bug: it never reflected an invitee's own "Maybe" answer.
          const selfAttendee = event.attendees?.find((a) => a.self === true);
          let tentative = event.status === "tentative"; // fallback for events with no attendee list at all

          if (selfAttendee) {
            if (selfAttendee.responseStatus === "declined") continue; // doesn't block their time at all
            tentative = selfAttendee.responseStatus === "tentative";
          }

          intervals.push({
            start: new Date(event.start.dateTime),
            end: new Date(event.end.dateTime),
            tentative,
          });
        }
        return intervals;
      } catch (err) {
        console.error(`Failed to read Google calendar ${calendarId}:`, err);
        hasError = true;
        return [];
      }
    })
  );

  return { intervals: results.flat(), hasError };
}

/** Creates an event on a specific calendar in this account and invites the given attendees. */
export async function createGoogleEvent(
  accountId: string,
  calendarId: string,
  opts: { title: string; description?: string; location?: string; start: Date; end: Date; attendeeEmails: string[] }
): Promise<string> {
  const calendar = await getGoogleClient(accountId);

  const res = await calendar.events.insert({
    calendarId,
    sendUpdates: "all",
    requestBody: {
      summary: opts.title,
      description: opts.description,
      location: opts.location,
      start: { dateTime: opts.start.toISOString() },
      end: { dateTime: opts.end.toISOString() },
      attendees: opts.attendeeEmails.map((email) => ({ email })),
    },
  });

  return res.data.id!;
}

/** Moves an existing event to a new time -- attendees see "this event was changed," not a new invite. */
export async function updateGoogleEventTime(
  accountId: string,
  calendarId: string,
  eventId: string,
  opts: { start: Date; end: Date }
): Promise<void> {
  const calendar = await getGoogleClient(accountId);
  await calendar.events.patch({
    calendarId,
    eventId,
    sendUpdates: "all",
    requestBody: {
      start: { dateTime: opts.start.toISOString() },
      end: { dateTime: opts.end.toISOString() },
    },
  });
}

/** Cancels the event and notifies every attendee via Google's own cancellation email. */
export async function deleteGoogleEvent(accountId: string, calendarId: string, eventId: string): Promise<void> {
  const calendar = await getGoogleClient(accountId);
  await calendar.events.delete({ calendarId, eventId, sendUpdates: "all" });
}
