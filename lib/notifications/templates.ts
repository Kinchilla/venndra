import { displayName } from "../displayName";

/**
 * Email copy for every notification trigger in lib/notifications/triggers.ts.
 *
 * Layout is lifted from lib/magicLink.ts's inline-table wrapper (same
 * palette: ink #231F20, paper #F0EBE0, amber #E8963A) so a notification email
 * reads as the same product as the sign-in one -- table-based markup and
 * inline styles because email clients, Outlook especially, are not browsers.
 *
 * Links are absolute via appUrl() below, the same NEXTAUTH_URL-with-localhost-
 * fallback pattern lib/phoneVerification.ts already uses for its texted link
 * -- there's no page for a relative URL in an email to be relative to.
 */

type EmailContent = { subject: string; text: string; html: string };

function appUrl(path: string): string {
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
}

/**
 * A confirmed event's time, in the EVENT's own timezone (not the reader's
 * device) -- this runs on the server with no browser to read a 12h/24h
 * preference from, so unlike lib/timeFormat.ts this is a fixed format
 * scoped to email only. "Thu, Sep 10, 6:00 PM MDT" tells the reader which
 * clock it's in without them having to guess.
 */
function formatEventTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: timezone,
  }).format(date);
}

/** The one-line, low-emphasis reminder every template ends its footer with. */
const MANAGE_LINE = "Manage which emails you get from Venndra in Settings.";

function wrap(heading: string, bodyHtml: string, cta: { text: string; href: string }): string {
  return `
<body style="margin:0;padding:0;background:#F0EBE0;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background:#F0EBE0;padding:32px 12px;">
    <tr>
      <td align="center">
        <table border="0" cellspacing="0" cellpadding="0" width="100%" style="max-width:520px;background:#ffffff;border:1px solid #D9D2C4;border-radius:16px;padding:32px;">
          <tr>
            <td style="font-family:Helvetica,Arial,sans-serif;font-size:22px;font-weight:600;color:#231F20;padding-bottom:8px;">
              ${heading}
            </td>
          </tr>
          <tr>
            <td style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:#231F20;opacity:0.7;padding-bottom:24px;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <a href="${cta.href}" target="_blank"
                 style="display:inline-block;background:#E8963A;color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:9999px;">
                ${cta.text}
              </a>
            </td>
          </tr>
          <tr>
            <td style="font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:#231F20;opacity:0.5;border-top:1px solid #D9D2C4;padding-top:20px;">
              ${MANAGE_LINE}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>`;
}

type Actor = { name?: string | null; email?: string | null };

export function friendRequestReceivedEmail(requester: Actor): EmailContent {
  const name = displayName(requester);
  return {
    subject: `${name} sent you a friend request on Venndra`,
    text: [
      `${name} sent you a friend request on Venndra.`,
      "",
      appUrl("/friends"),
      "",
      MANAGE_LINE,
    ].join("\n"),
    html: wrap(
      "New friend request",
      `<strong style="color:#231F20;opacity:1;">${name}</strong> sent you a friend request on Venndra.`,
      { text: "View request", href: appUrl("/friends") }
    ),
  };
}

export function friendRequestAcceptedEmail(addressee: Actor): EmailContent {
  const name = displayName(addressee);
  return {
    subject: `${name} accepted your friend request`,
    text: [
      `${name} accepted your friend request on Venndra. You can invite each other to events now.`,
      "",
      appUrl("/friends"),
      "",
      MANAGE_LINE,
    ].join("\n"),
    html: wrap(
      "Friend request accepted",
      `<strong style="color:#231F20;opacity:1;">${name}</strong> accepted your friend request. You can invite each other to events now.`,
      { text: "View friends", href: appUrl("/friends") }
    ),
  };
}

export function addedToEventEmail(creator: Actor, event: { id: string; title: string }): EmailContent {
  const name = displayName(creator);
  return {
    subject: `${name} invited you to "${event.title}"`,
    text: [
      `${name} invited you to "${event.title}" on Venndra. Connect a calendar to be counted in the search.`,
      "",
      appUrl(`/events/${event.id}`),
      "",
      MANAGE_LINE,
    ].join("\n"),
    html: wrap(
      "You're invited to an event",
      `<strong style="color:#231F20;opacity:1;">${name}</strong> invited you to <strong style="color:#231F20;opacity:1;">${event.title}</strong>. Connect a calendar to be counted in the search.`,
      { text: "View event", href: appUrl(`/events/${event.id}`) }
    ),
  };
}

export function eventConfirmedEmail(
  organizer: Actor,
  event: { id: string; title: string; confirmedStart: Date; timezone: string }
): EmailContent {
  const name = displayName(organizer);
  const when = formatEventTime(event.confirmedStart, event.timezone);
  return {
    subject: `"${event.title}" is confirmed for ${when}`,
    text: [
      `${name} confirmed "${event.title}" for ${when}.`,
      "",
      appUrl(`/events/${event.id}`),
      "",
      MANAGE_LINE,
    ].join("\n"),
    html: wrap(
      "Event confirmed",
      `<strong style="color:#231F20;opacity:1;">${name}</strong> confirmed <strong style="color:#231F20;opacity:1;">${event.title}</strong> for <strong style="color:#231F20;opacity:1;">${when}</strong>.`,
      { text: "View event", href: appUrl(`/events/${event.id}`) }
    ),
  };
}

export function eventCancelledEmail(organizer: Actor, event: { id: string; title: string }): EmailContent {
  const name = displayName(organizer);
  return {
    subject: `"${event.title}" was cancelled`,
    text: [
      `${name} cancelled "${event.title}".`,
      "",
      appUrl(`/events/${event.id}`),
      "",
      MANAGE_LINE,
    ].join("\n"),
    html: wrap(
      "Event cancelled",
      `<strong style="color:#231F20;opacity:1;">${name}</strong> cancelled <strong style="color:#231F20;opacity:1;">${event.title}</strong>.`,
      { text: "View event", href: appUrl(`/events/${event.id}`) }
    ),
  };
}

export function participantLeftEventEmail(participant: Actor, event: { id: string; title: string }): EmailContent {
  const name = displayName(participant);
  return {
    subject: `${name} left "${event.title}"`,
    text: [
      `${name} left "${event.title}", the event you're organizing.`,
      "",
      appUrl(`/events/${event.id}`),
      "",
      MANAGE_LINE,
    ].join("\n"),
    html: wrap(
      "A participant left your event",
      `<strong style="color:#231F20;opacity:1;">${name}</strong> left <strong style="color:#231F20;opacity:1;">${event.title}</strong>, the event you're organizing.`,
      { text: "View event", href: appUrl(`/events/${event.id}`) }
    ),
  };
}
