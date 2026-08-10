import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { prisma } from "../../../../lib/prisma";
import { upcomingConfirmedWhere } from "../../../../lib/eventLifecycle";

/**
 * Lists every connected account -- Google, Microsoft and Apple/iCloud -- for
 * the "Connected accounts" section.
 *
 * Each row carries its own `disconnectBlockedReason`, computed here rather than
 * re-derived in the UI, so the tooltip, the disabled state and the error the
 * DELETE route would actually return can't drift apart. Null means allowed.
 *
 * This is a MIRROR, not the rule. Disconnection is enforced by the DELETE in
 * ./[id]/route.ts, which is also where the reasoning lives and which lists the
 * three places (this one included) that have to change together. Nothing here
 * is a security boundary -- a caller can always just send the DELETE.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as any).id;

  const calendars = await prisma.connectedCalendar.findMany({
    where: { userId },
    select: {
      id: true,
      provider: true,
      label: true,
      accountEmail: true,
      isEnabled: true,
      nextAuthAccountId: true,
      sources: { select: { id: true, isWriteTarget: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const enabledCount = await prisma.connectedCalendar.count({ where: { userId, isEnabled: true } });

  // Whether this user could sign in with a magic link if every OAuth account
  // went away -- true for anyone with an email address on file, since
  // NextAuth's email branch matches on User.email alone. When it's true, no
  // OAuth account is load-bearing for sign-in and the credential guard below
  // doesn't apply. See the DELETE route for the full reasoning.
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const canSignInWithEmail = !!user?.email;
  const accountCount = await prisma.account.count({ where: { userId } });

  const allSourceIds = calendars.flatMap((c) => c.sources.map((s) => s.id));
  const blockingEvents = allSourceIds.length
    ? await prisma.event.findMany({
        where: { ...upcomingConfirmedWhere(), writeCalendarSourceId: { in: allSourceIds } },
        select: { writeCalendarSourceId: true },
      })
    : [];

  const blockingCountBySourceId = new Map<string, number>();
  for (const e of blockingEvents) {
    if (!e.writeCalendarSourceId) continue;
    blockingCountBySourceId.set(
      e.writeCalendarSourceId,
      (blockingCountBySourceId.get(e.writeCalendarSourceId) ?? 0) + 1
    );
  }

  const accounts = calendars.map((c) => {
    const confirmedEventCount = c.sources.reduce(
      (sum, s) => sum + (blockingCountBySourceId.get(s.id) ?? 0),
      0
    );

    // Mirrors the DELETE route's guard order exactly, so the tooltip always
    // names the reason the request would actually fail on.
    let disconnectBlockedReason: string | null = null;
    if (c.nextAuthAccountId && !canSignInWithEmail && accountCount <= 1) {
      disconnectBlockedReason = "This is the only account you can sign in with — connect another one first.";
    } else if (enabledCount <= 1) {
      disconnectBlockedReason = "This is your only connected calendar — connect another one first.";
    } else if (confirmedEventCount > 0) {
      disconnectBlockedReason = `This calendar is holding ${confirmedEventCount} upcoming event${
        confirmedEventCount === 1 ? "" : "s"
      } — cancel ${confirmedEventCount === 1 ? "it" : "them"} first, then disconnect. Events already in the past don't block this.`;
    }

    return {
      id: c.id,
      provider: c.provider,
      accountEmail: c.accountEmail,
      label: c.label,
      confirmedEventCount,
      disconnectBlockedReason,
      // Lets the confirm dialog warn that "save new events here" is about to
      // move. The move itself is automatic -- deleting the calendar drops its
      // isWriteTarget flag, and the follow-up sync assigns a new one.
      holdsWriteTarget: c.sources.some((s) => s.isWriteTarget),
      // Whether disconnecting also gives up a sign-in credential, which changes
      // what the confirm dialog has to warn about.
      isLoginMethod: !!c.nextAuthAccountId,
    };
  });

  return NextResponse.json({ accounts });
}
