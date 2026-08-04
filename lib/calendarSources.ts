import { prisma } from "./prisma";
import { listGoogleCalendars } from "./calendar/google";
import { listMicrosoftCalendars } from "./calendar/microsoft";
import { listAppleCalendars } from "./calendar/apple";
import type { CalendarListing } from "./calendar/google";

/**
 * Fetches every calendar currently in an account and syncs CalendarSource
 * rows to match: creates one for anything new (defaulting to
 * checkAvailability=true, matching Calendly's "counts by default, opt out
 * per-calendar" behavior), updates labels that changed, and removes rows
 * for calendars that no longer exist upstream. Exactly one CalendarSource
 * across the user's ENTIRE set of connected calendars ends up as the write
 * target -- if the user doesn't have one yet, this account's "main"
 * calendar (Google's "primary", Microsoft's default calendar, or Apple's
 * first calendar) becomes it automatically.
 *
 * Called both when an account is first connected AND every time the
 * calendars settings panel is loaded (see GET /api/calendars), so a
 * calendar someone creates in Google later just shows up next time they
 * check their settings -- no manual "refresh" action needed.
 */
export async function populateCalendarSources(connectedCalendarId: string): Promise<void> {
  const cal = await prisma.connectedCalendar.findUnique({ where: { id: connectedCalendarId } });
  if (!cal) return;

  let listings: CalendarListing[] = [];

  try {
    if (cal.provider === "GOOGLE" && cal.nextAuthAccountId) {
      listings = await listGoogleCalendars(cal.nextAuthAccountId);
    } else if (cal.provider === "MICROSOFT" && cal.nextAuthAccountId) {
      listings = await listMicrosoftCalendars(cal.nextAuthAccountId);
    } else if (cal.provider === "APPLE_CALDAV") {
      listings = await listAppleCalendars(cal.id);
    }
  } catch (err) {
    // A transient failure here (e.g. a rate limit) shouldn't wipe out
    // existing CalendarSource rows -- bail without touching anything.
    console.error(`Failed to list calendars for connected calendar ${connectedCalendarId}:`, err);
    return;
  }

  if (listings.length === 0) return;

  // Prefer whichever listing is flagged as the account's real primary
  // calendar; fall back to the first one if a provider doesn't expose that
  // (shouldn't happen for Google/Microsoft, only relevant for Apple, which
  // can never be a write target anyway -- see canBeWriteTarget below).
  const mainListing = listings.find((l) => l.isPrimary) ?? listings[0];

  const userHasWriteTarget = await prisma.calendarSource.findFirst({
    where: { connectedCalendar: { userId: cal.userId }, isWriteTarget: true },
  });

  // Apple can be a write target now, but with a real-invite limitation --
  // see lib/calendar/apple.ts. When a real (non-Apple) write-capable
  // calendar exists, prefer it: if the user's current write target is an
  // AUTO-assigned Apple source (never one they explicitly chose --
  // writeTargetAutoAssigned distinguishes the two) and this sync is for a
  // non-Apple account, treat that as if there were no write target at all,
  // so the new account's main calendar takes over below.
  const currentAutoAssignedAppleTarget =
    cal.provider !== "APPLE_CALDAV"
      ? await prisma.calendarSource.findFirst({
          where: {
            isWriteTarget: true,
            writeTargetAutoAssigned: true,
            connectedCalendar: { userId: cal.userId, provider: "APPLE_CALDAV" },
          },
        })
      : null;

  // Only true when the user has NO write target anywhere among all their
  // connected calendars (or their only one is an auto-assigned Apple
  // target being superseded by a real alternative, per above). When this
  // is true, we actively (re-)assign the main calendar on EVERY sync --
  // not just the moment a row is first created -- so a user who ends up
  // with none set (e.g. from an old bug, or a deleted calendar that used
  // to be the target) gets one restored automatically next time they load
  // Settings, rather than being stuck until they notice and click a radio
  // button themselves. When it's false, we deliberately leave
  // isWriteTarget untouched on update, so an already-correct existing
  // choice -- Apple or not -- is never silently overwritten.
  const shouldAutoAssign = !userHasWriteTarget || !!currentAutoAssignedAppleTarget;

  const freshExternalIds = listings.map((l) => l.externalId);

  await prisma.$transaction([
    // Drop any calendar that no longer exists upstream (deleted or
    // unshared since we last checked). If that happened to be the write
    // target, the organizer will need to pick a new one before their next
    // confirm -- rare enough not to special-case further here.
    prisma.calendarSource.deleteMany({
      where: { connectedCalendarId, externalId: { notIn: freshExternalIds } },
    }),
    // Unset the auto-assigned Apple write target being superseded, in the
    // same transaction as the reassignment below -- otherwise there'd be a
    // window with two isWriteTarget rows (or briefly zero), the same class
    // of bug the explicit-choice PATCH route's transaction already guards
    // against.
    ...(currentAutoAssignedAppleTarget
      ? [
          prisma.calendarSource.update({
            where: { id: currentAutoAssignedAppleTarget.id },
            data: { isWriteTarget: false, writeTargetAutoAssigned: false },
          }),
        ]
      : []),
    ...listings.map((listing) => {
      const isMain = listing.externalId === mainListing?.externalId;
      return prisma.calendarSource.upsert({
        where: { connectedCalendarId_externalId: { connectedCalendarId, externalId: listing.externalId } },
        create: {
          connectedCalendarId,
          externalId: listing.externalId,
          label: listing.label,
          checkAvailability: true,
          isWriteTarget: shouldAutoAssign && isMain,
          writeTargetAutoAssigned: shouldAutoAssign && isMain,
        },
        update: shouldAutoAssign
          ? { label: listing.label, isWriteTarget: isMain, writeTargetAutoAssigned: isMain }
          : { label: listing.label },
      });
    }),
  ]);
}
