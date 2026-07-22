import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import { populateCalendarSources } from "../../../lib/calendarSources";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as any).id;

  // Re-sync each connected account's calendar list on the way in, so a
  // calendar created (or deleted) upstream since the last visit just shows
  // up here -- no separate "refresh" action for the user to remember. Only
  // done when explicitly asked (the settings panel does this once, on
  // load) so routine actions like toggling a checkbox don't each pay the
  // cost of round-tripping to Google/Microsoft/iCloud.
  if (req.nextUrl.searchParams.get("sync") === "1") {
    const connectedIds = await prisma.connectedCalendar.findMany({
      where: { userId, isEnabled: true },
      select: { id: true },
    });
    await Promise.all(connectedIds.map((c) => populateCalendarSources(c.id)));
  }

  const calendars = await prisma.connectedCalendar.findMany({
    where: { userId },
    select: {
      id: true,
      provider: true,
      label: true,
      isEnabled: true,
      sources: {
        select: { id: true, externalId: true, label: true, checkAvailability: true, isWriteTarget: true },
        orderBy: { label: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ calendars });
}
