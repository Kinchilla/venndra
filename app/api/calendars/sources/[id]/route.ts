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
    if (source.connectedCalendar.provider === "APPLE_CALDAV") {
      return NextResponse.json(
        { error: "iCloud calendars can't be a write target yet -- Apple write-back isn't supported (see README)" },
        { status: 400 }
      );
    }
    // Exactly one write target across the user's ENTIRE set of connected
    // calendars, not just within this account.
    await prisma.calendarSource.updateMany({
      where: { connectedCalendar: { userId } },
      data: { isWriteTarget: false },
    });
    await prisma.calendarSource.update({ where: { id: source.id }, data: { isWriteTarget: true } });
  }

  if (typeof parsed.data.checkAvailability === "boolean") {
    await prisma.calendarSource.update({
      where: { id: source.id },
      data: { checkAvailability: parsed.data.checkAvailability },
    });
  }

  return NextResponse.json({ ok: true });
}
