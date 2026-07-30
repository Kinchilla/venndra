import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";
import { checkRateLimit } from "../../../../../lib/rateLimit";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as any).id;

  const allowed = await checkRateLimit("join", userId, 10);
  if (!allowed) {
    return NextResponse.json({ error: "Too many attempts — wait a moment and try again." }, { status: 429 });
  }

  const participant = await prisma.eventParticipant.findUnique({
    where: { eventId_email: { eventId: params.id, email: session.user.email } },
  });
  if (!participant) {
    return NextResponse.json({ error: "You weren't invited to this event" }, { status: 404 });
  }

  const hasCalendar = await prisma.connectedCalendar.findFirst({ where: { userId, isEnabled: true } });

  const updated = await prisma.eventParticipant.update({
    where: { id: participant.id },
    data: { userId, status: hasCalendar ? "CONNECTED" : "INVITED" },
  });

  return NextResponse.json({ participant: updated });
}
