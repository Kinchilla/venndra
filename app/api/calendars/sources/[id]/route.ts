import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";

const patchSchema = z.object({
  checkAvailability: z.boolean().optional(),
  isWriteTarget: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as any).id;
  const parsed = patchSchema.safeParse(await req.json());
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
