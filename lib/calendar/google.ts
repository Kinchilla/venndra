import { google } from "googleapis";
import { prisma } from "../prisma";
import { noteDeadGrant } from "./authHealth";

/**
 * Builds an authenticated Google client for a given internal Account.id,
 * refreshing the access token if needed. Google's client library handles
 * the refresh itself once handed the refresh_token; we persist whatever new
 * access_token it returns so we don't refresh on every call.
 *
 * Returns the write alongside the client rather than firing it and forgetting
 * it. The "tokens" event is emitted from inside the library's own refresh, so
 * there is no call of ours to await to know the new credentials were written
 * down -- and EventEmitter discards whatever a listener returns, so an async
 * listener is unawaited by construction. That costs two things on a
 * serverless host: the invocation can be frozen the moment the response is
 * sent, dropping an in-flight write, and a rejected update becomes an
 * unhandled rejection with nobody to catch it. So the listener only *records*
 * its write, and every exported function below awaits flushTokenWrites() in a
 * finally before returning.
 *
 * What a dropped write actually costs is small TODAY -- Google issues a new
 * refresh_token only from an authorization-code exchange, never from a
 * refresh, so `tokens.refresh_token` is effectively always absent here and
 * the loss is one access_token, i.e. one extra refresh next time. It is
 * written down anyway because the day that stops being true, the failure is
 * a permanently dead connection that only a reconnect fixes, and it would
 * look exactly like the Testing-mode expiry it would be mistaken for.
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

  const pendingTokenWrites: Promise<unknown>[] = [];

  oauth2Client.on("tokens", (tokens) => {
    pendingTokenWrites.push(
      prisma.account.update({
        where: { id: accountId },
        data: {
          access_token: tokens.access_token ?? account.access_token,
          expires_at: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : account.expires_at,
          refresh_token: tokens.refresh_token ?? account.refresh_token,
        },
      })
    );
  });

  /**
   * Settles any token write the library kicked off during this request.
   * allSettled rather than all, and deliberately never rethrows: a failed
   * token write must not mask the result -- or the error -- of the API call
   * the caller actually made. Losing it costs one extra refresh next time;
   * throwing here would cost the whole request.
   */
  async function flushTokenWrites(): Promise<void> {
    if (pendingTokenWrites.length === 0) return;
    const settled = await Promise.allSettled(pendingTokenWrites.splice(0));
    for (const result of settled) {
      if (result.status === "rejected") {
        console.error(`Failed to persist refreshed Google token for account ${accountId}:`, result.reason);
      }
    }
  }

  return { calendar: google.calendar({ version: "v3", auth: oauth2Client }), flushTokenWrites };
}

export type BusyInterval = { start: Date; end: Date; tentative: boolean };
export type CalendarListing = { externalId: string; label: string; isPrimary: boolean };

/** Lists every calendar visible in this Google account (personal, work, shared, holidays, etc). */
export async function listGoogleCalendars(accountId: string): Promise<CalendarListing[]> {
  const { calendar, flushTokenWrites } = await getGoogleClient(accountId);
  try {
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
  } catch (err) {
    await noteDeadGrant(accountId, err);
    throw err;
  } finally {
    await flushTokenWrites();
  }
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
  const { calendar, flushTokenWrites } = await getGoogleClient(accountId);
  try {
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
          console.error(`Failed to read Google calendar ${calendarId} on account ${accountId}:`, err);
          await noteDeadGrant(accountId, err);
          hasError = true;
          return [];
        }
      })
    );

    return { intervals: results.flat(), hasError };
  } catch (err) {
    await noteDeadGrant(accountId, err);
    throw err;
  } finally {
    await flushTokenWrites();
  }
}

/** Creates an event on a specific calendar in this account and invites the given attendees. */
export async function createGoogleEvent(
  accountId: string,
  calendarId: string,
  opts: { title: string; description?: string; location?: string; start: Date; end: Date; attendeeEmails: string[] }
): Promise<string> {
  const { calendar, flushTokenWrites } = await getGoogleClient(accountId);
  try {

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
  } catch (err) {
    await noteDeadGrant(accountId, err);
    throw err;
  } finally {
    await flushTokenWrites();
  }
}

/** Moves an existing event to a new time -- attendees see "this event was changed," not a new invite. */
export async function updateGoogleEventTime(
  accountId: string,
  calendarId: string,
  eventId: string,
  opts: { start: Date; end: Date }
): Promise<void> {
  const { calendar, flushTokenWrites } = await getGoogleClient(accountId);
  try {
    await calendar.events.patch({
      calendarId,
      eventId,
      sendUpdates: "all",
      requestBody: {
        start: { dateTime: opts.start.toISOString() },
        end: { dateTime: opts.end.toISOString() },
      },
    });
  } catch (err) {
    await noteDeadGrant(accountId, err);
    throw err;
  } finally {
    await flushTokenWrites();
  }
}

/** Cancels the event and notifies every attendee via Google's own cancellation email. */
export async function deleteGoogleEvent(accountId: string, calendarId: string, eventId: string): Promise<void> {
  const { calendar, flushTokenWrites } = await getGoogleClient(accountId);
  try {
    await calendar.events.delete({ calendarId, eventId, sendUpdates: "all" });
  } catch (err) {
    await noteDeadGrant(accountId, err);
    throw err;
  } finally {
    await flushTokenWrites();
  }
}

/**
 * Removes a single attendee from an existing event without cancelling it for
 * everyone else. Google's API has no dedicated "remove one attendee"
 * endpoint -- the standard approach is fetching the current attendee list,
 * filtering out the departing person, and patching the full list back.
 */
export async function removeGoogleAttendee(
  accountId: string,
  calendarId: string,
  eventId: string,
  attendeeEmail: string
): Promise<void> {
  const { calendar, flushTokenWrites } = await getGoogleClient(accountId);
  try {
    const existing = await calendar.events.get({ calendarId, eventId });
    const attendees = (existing.data.attendees ?? []).filter(
      (a) => a.email?.toLowerCase() !== attendeeEmail.toLowerCase()
    );
    await calendar.events.patch({
      calendarId,
      eventId,
      sendUpdates: "all",
      requestBody: { attendees },
    });
  } catch (err) {
    await noteDeadGrant(accountId, err);
    throw err;
  } finally {
    await flushTokenWrites();
  }
}
