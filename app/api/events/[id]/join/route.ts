import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { checkRateLimit } from "../../../../../lib/rateLimit";
import { currentUser, unauthorized } from "../../../../../lib/session";

export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const sessionUser = await currentUser();
  if (!sessionUser?.email) return unauthorized();

  const userId = sessionUser.id;

  const allowed = await checkRateLimit("join", userId, 10);
  if (!allowed) {
    return NextResponse.json({ error: "Too many attempts — wait a moment and try again." }, { status: 429 });
  }

  const participant = await prisma.eventParticipant.findUnique({
    where: { eventId_email: { eventId: params.id, email: sessionUser.email } },
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
