import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../../../lib/prisma";
import { jsonBody } from "../../../../../lib/requestBody";
import { currentUser, unauthorized } from "../../../../../lib/session";

const patchSchema = z.object({
  checkAvailability: z.boolean().optional(),
  isWriteTarget: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const sessionUser = await currentUser();
  if (!sessionUser) return unauthorized();

  const userId = sessionUser.id;
  const parsed = patchSchema.safeParse(await jsonBody(req));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const source = await prisma.calendarSource.findUnique({
    where: { id: params.id },
    include: { connectedCalendar: true },
  });
  if (!source || source.connectedCalendar.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (parsed.data.isWriteTarget === true) {
    // Exactly one write target across the user's ENTIRE set of connected
    // calendars, not just within this account. These two writes run as a
    // single atomic transaction -- doing them as two separately-awaited
    // calls left a real window where the database briefly had ZERO write
    // targets set, which a concurrent calendar sync could observe and
    // "helpfully" auto-assign the primary calendar back, silently
    // clobbering the user's actual selection. This is very likely what
    // happened to the friend who reported this.
    //
    // writeTargetAutoAssigned is explicitly forced false here -- this is a
    // real user choice, not an auto-assignment, so populateCalendarSources'
    // "prefer non-Apple" auto-switch rule must never later treat it as
    // something safe to silently override.
    await prisma.$transaction([
      prisma.calendarSource.updateMany({
        where: { connectedCalendar: { userId } },
        data: { isWriteTarget: false, writeTargetAutoAssigned: false },
      }),
      prisma.calendarSource.update({
        where: { id: source.id },
        data: { isWriteTarget: true, writeTargetAutoAssigned: false },
      }),
    ]);
  }

  if (typeof parsed.data.checkAvailability === "boolean") {
    await prisma.calendarSource.update({
      where: { id: source.id },
      data: { checkAvailability: parsed.data.checkAvailability },
    });
  }

  return NextResponse.json({ ok: true });
}
