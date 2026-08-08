import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";
import { upcomingConfirmedWhere } from "../../../../../lib/eventLifecycle";
import { findIdentityCalendarId } from "../../../../../lib/identityAccount";

/**
 * Disconnect a connected calendar: the ConnectedCalendar row and its
 * CalendarSources are deleted, and the account disappears from the list.
 *
 * For an OAuth account this deletes the NextAuth Account row too, which is what
 * releases that provider account so a different Venndra user could later link
 * it. The identity account is exempt -- see below.
 *
 * A NextAuth Account row is simultaneously a sign-in credential and the token
 * source ConnectedCalendar.nextAuthAccountId reads calendars through, so
 * removing one always has a sign-in consequence. Which consequence depends
 * entirely on whether its address is the user's identity email:
 *
 *   - IDENTITY account (accountEmail === User.email). Deleting it would leave a
 *     Venndra account whose own email address can no longer sign into it:
 *     signed out, NextAuth finds a user with that email and throws
 *     AccountNotLinkedError rather than letting them in. There's no recovery
 *     from inside the app either, because User.email is immutable -- nothing in
 *     the codebase updates it after signup (see app/api/me, which only accepts
 *     name/timezone/defaultSearchFilters). Friends would also still be inviting
 *     them at that address, since participant matching keys on User.email. So
 *     this one is permanently exempt.
 *   - ANY OTHER linked account. Deleting it genuinely releases the account:
 *     signing in with it afterwards creates a separate new Venndra account,
 *     which is the correct meaning of "no longer associated with anyone."
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as any).id;

  const calendar = await prisma.connectedCalendar.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      userId: true,
      nextAuthAccountId: true,
      accountEmail: true,
      sources: { select: { id: true } },
    },
  });
  if (!calendar || calendar.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (calendar.nextAuthAccountId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });

    // Checked before anything else: absolute, not a "not right now" condition
    // the user could clear by rearranging their other accounts.
    const identityCalendarId = await findIdentityCalendarId(userId, user?.email ?? null);
    if (calendar.id === identityCalendarId) {
      return NextResponse.json(
        { error: "This is the account you sign into Venndra with, so it can't be disconnected." },
        { status: 400 }
      );
    }

    // Backstop for the case the identity rule can't see: accountEmail is
    // nullable (some Microsoft work accounts return no email claim), so a user
    // whose linked accounts all have null emails would match nothing above and
    // could otherwise delete every credential they own. Removing the last one
    // is never allowed regardless of which rule got us here.
    const accountCount = await prisma.account.count({ where: { userId } });
    if (accountCount <= 1) {
      return NextResponse.json(
        { error: "This is the only account you can sign in with — connect another one before disconnecting this." },
        { status: 400 }
      );
    }
  }

  const enabledCount = await prisma.connectedCalendar.count({ where: { userId, isEnabled: true } });
  if (enabledCount <= 1) {
    return NextResponse.json(
      { error: "This is your only connected calendar — connect another one before disconnecting this." },
      { status: 400 }
    );
  }

  // An UPCOMING confirmed event's writeCalendarSourceId points at the calendar
  // its real upstream event lives on, and Cancel / Reschedule / Leave all
  // re-target that same calendar. Deleting it would strand them. Counted
  // regardless of who created the event: after an organizer hand-off it points
  // at the NEW organizer's calendar.
  //
  // Past events are excluded (see lib/eventLifecycle): none of those actions
  // are offered on them, so they need nothing from this calendar, and counting
  // them would make a calendar undetachable forever just for having been used.
  const sourceIds = calendar.sources.map((s) => s.id);
  const confirmedEventCount = sourceIds.length
    ? await prisma.event.count({
        where: { ...upcomingConfirmedWhere(), writeCalendarSourceId: { in: sourceIds } },
      })
    : 0;

  if (confirmedEventCount > 0) {
    return NextResponse.json(
      {
        error: `This calendar is holding ${confirmedEventCount} upcoming event${
          confirmedEventCount === 1 ? "" : "s"
        } — cancel ${confirmedEventCount === 1 ? "it" : "them"} first, then disconnect.`,
        confirmedEventCount,
      },
      { status: 409 }
    );
  }

  // CalendarSource rows cascade off ConnectedCalendar, so this also drops any
  // isWriteTarget flag living on this account. The user is then briefly without
  // a write target, which populateCalendarSources repairs on the next sync --
  // its "no write target anywhere" branch re-assigns one automatically, and the
  // UI triggers that sync immediately after this returns.
  //
  // The Account row goes in the same transaction for OAuth accounts -- that's
  // the part that actually releases the provider account. Apple has no Account
  // row; its credential (caldavPasswordEncrypted) lives on the ConnectedCalendar
  // being deleted, so it goes with it either way.
  await prisma.$transaction([
    prisma.connectedCalendar.delete({ where: { id: calendar.id } }),
    ...(calendar.nextAuthAccountId
      ? [prisma.account.delete({ where: { id: calendar.nextAuthAccountId } })]
      : []),
  ]);

  return NextResponse.json({ ok: true });
}
