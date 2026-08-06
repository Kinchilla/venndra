import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    include: { participants: { include: { user: { select: { name: true } } } } },
  });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const userId = (session.user as any).id;
  if (event.creatorId !== userId) {
    return NextResponse.json({ error: "Only the event organizer can do this" }, { status: 403 });
  }
  if (event.status !== "SEARCHING" && event.status !== "CONFIRMED") {
    return NextResponse.json({ error: "This event isn't active" }, { status: 400 });
  }

  const others = event.participants.filter((p) => p.userId !== event.creatorId);

  const candidates = await Promise.all(
    others.map(async (p) => {
      if (p.status === "INVITED" || !p.userId) {
        return { userId: null, name: null, email: p.email, eligible: false, reason: "not-joined" as const, provider: null };
      }

      // Same check confirm/route.ts uses for the organizer's own write
      // target. Provider is included so the UI can show the Apple
      // manual-invite caveat for this specific candidate before they're
      // picked, not just after the fact.
      const writeSource = await prisma.calendarSource.findFirst({
        where: { connectedCalendar: { userId: p.userId, isEnabled: true }, isWriteTarget: true },
        include: { connectedCalendar: { select: { provider: true } } },
      });

      return writeSource
        ? {
            userId: p.userId,
            name: p.user?.name ?? null,
            email: p.email,
            eligible: true,
            reason: null,
            provider: writeSource.connectedCalendar.provider,
          }
        : {
            userId: p.userId,
            name: p.user?.name ?? null,
            email: p.email,
            eligible: false,
            reason: "no-write-target" as const,
            provider: null,
          };
    })
  );

  return NextResponse.json({ candidates });
}
