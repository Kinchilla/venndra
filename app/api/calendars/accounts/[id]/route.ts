import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";
import { upcomingConfirmedWhere } from "../../../../../lib/eventLifecycle";

/**
 * Disconnect a connected calendar: the ConnectedCalendar row and its
 * CalendarSources are deleted, and the account disappears from the list.
 *
 * For an OAuth account this deletes the NextAuth Account row too, which is what
 * releases that provider account so a different Venndra user could later link
 * it.
 *
 * A NextAuth Account row is simultaneously a sign-in credential and the token
 * source ConnectedCalendar.nextAuthAccountId reads calendars through, so
 * removing one always has a sign-in consequence. Since magic-link sign-in
 * exists, that consequence is survivable for almost everyone: the user's email
 * address is itself a way in, so giving up an OAuth account costs them a
 * shortcut, not their account. Deleting it also genuinely releases the
 * provider account -- signing in with it afterwards starts a separate new
 * Venndra account, which is the correct meaning of "no longer associated with
 * anyone."
 *
 * The one exception is a user with no email on file at all (User.email is
 * nullable; some Microsoft work accounts return no email claim), for whom an
 * Account row really is the only credential. See the guard below.
 *
 * ---
 *
 * WHAT MAY BE DISCONNECTED IS DECIDED IN THREE PLACES. This route is the only
 * one that enforces anything; the other two exist so the UI doesn't offer a
 * button the server will refuse, or refuse one without saying why. Change the
 * rule here and both of the others need the same change, or they drift:
 *
 *   1. HERE -- the actual check. The only one that matters for correctness,
 *      since the other two are client-visible and therefore advisory.
 *   2. The GET in ../route.ts, which precomputes `disconnectBlockedReason`
 *      per account. It deliberately mirrors this route's guard ORDER as well
 *      as its conditions, so the tooltip names the reason a real DELETE would
 *      actually fail on rather than some other one that also applies.
 *   3. components/ConnectedAccountsSection.tsx, which doesn't re-derive the
 *      rules but does describe their consequences in prose -- the confirm
 *      dialog and the footer note under the list. Copy is where this last
 *      went stale: both still claimed the sign-in account could never be
 *      disconnected after that stopped being true.
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

    // Magic-link sign-in reopened this question. Both of the rules that used
    // to live here -- the identity account is permanently exempt, and the last
    // Account row can never go -- existed for one reason: an OAuth Account was
    // the ONLY way back into a Venndra account, so deleting the wrong one
    // locked the owner out for good with no in-app recovery.
    //
    // That premise is gone. NextAuth's email branch matches on User.email
    // alone, whatever created the account (see the linking note in
    // lib/auth.ts), so anyone with an address on file can always sign in with
    // a magic link no matter what happens to their OAuth accounts. Keeping the
    // old guards would now mean telling a magic-link user that a Google
    // account "is the account you sign into Venndra with" -- which isn't true
    // -- and permanently trapping an email-only user in the first OAuth
    // calendar they ever connected.
    //
    // What survives is the case where email genuinely isn't a way in:
    // User.email is nullable, and some Microsoft work accounts return no email
    // claim at all. For those users an Account row really is the last
    // credential, and the old rule still applies.
    if (!user?.email) {
      const accountCount = await prisma.account.count({ where: { userId } });
      if (accountCount <= 1) {
        return NextResponse.json(
          { error: "This is the only account you can sign in with — connect another one before disconnecting this." },
          { status: 400 }
        );
      }
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
