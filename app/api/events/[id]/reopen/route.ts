import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";
import { deleteGoogleEvent } from "../../../../../lib/calendar/google";
import { deleteMicrosoftEvent } from "../../../../../lib/calendar/microsoft";
import { deleteAppleEvent } from "../../../../../lib/calendar/apple";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const userId = (session.user as any).id;
  if (event.creatorId !== userId) {
    return NextResponse.json({ error: "Only the event creator can reschedule" }, { status: 403 });
  }
  if (event.status !== "CONFIRMED") {
    return NextResponse.json({ error: "Only a confirmed event can be rescheduled" }, { status: 409 });
  }

  // Delete the existing calendar event right away, rather than leaving it
  // in place until a new time is confirmed -- otherwise it keeps blocking
  // its own old time slot on every participant's calendar while the
  // search is reopened, which quietly sabotages the very re-search you're
  // doing (a phantom "busy" that drags that slot to the bottom of
  // everyone's results). This means attendees see a real cancellation now,
  // and a fresh invite once a new time is confirmed -- a deliberate
  // trade-off, not an oversight; see README.
  if (event.externalEventId && event.writeCalendarSourceId) {
    const writeSource = await prisma.calendarSource.findUnique({
      where: { id: event.writeCalendarSourceId },
      include: { connectedCalendar: true },
    });
    try {
      if (writeSource?.connectedCalendar.provider === "GOOGLE" && writeSource.connectedCalendar.nextAuthAccountId) {
        await deleteGoogleEvent(writeSource.connectedCalendar.nextAuthAccountId, writeSource.externalId, event.externalEventId);
      } else if (
        writeSource?.connectedCalendar.provider === "MICROSOFT" &&
        writeSource.connectedCalendar.nextAuthAccountId
      ) {
        await deleteMicrosoftEvent(writeSource.connectedCalendar.nextAuthAccountId, event.externalEventId);
      } else if (writeSource?.connectedCalendar.provider === "APPLE_CALDAV" && event.externalEventHref) {
        await deleteAppleEvent(writeSource.connectedCalendar.id, {
          href: event.externalEventHref,
          etag: event.externalEventEtag,
        });
      }
    } catch (err) {
      // If it was already removed by hand, don't block reopening the
      // search over it.
      console.error("Failed to delete upstream calendar event during reschedule:", err);
    }
  }

  // Clear externalEventId/writeCalendarSourceId too -- since the old
  // calendar event is gone, the next confirm should CREATE a fresh one,
  // not try to patch a now-deleted event that no longer exists. Also clear
  // the Apple-only href/etag and any stale writeError, since they're all
  // tied to the now-deleted upstream event.
  const updated = await prisma.event.update({
    where: { id: event.id },
    data: {
      status: "SEARCHING",
      confirmedStart: null,
      confirmedEnd: null,
      externalEventId: null,
      externalEventHref: null,
      externalEventEtag: null,
      writeError: null,
      writeCalendarSourceId: null,
    },
  });

  return NextResponse.json({ event: updated });
}