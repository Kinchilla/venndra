import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { currentUser, unauthorized } from "../../../../lib/session";

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const sessionUser = await currentUser();
  if (!sessionUser) return unauthorized();

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    include: { participants: true, creator: { select: { id: true, name: true, email: true } } },
  });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const userId = sessionUser.id;
  const isInvolved =
    event.creatorId === userId || event.participants.some((p) => p.email === sessionUser.email);
  if (!isInvolved) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ event });
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const sessionUser = await currentUser();
  if (!sessionUser) return unauthorized();

  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const userId = sessionUser.id;
  if (event.creatorId !== userId) {
    return NextResponse.json({ error: "Only the event creator can delete this" }, { status: 403 });
  }

  // Only lets you delete an event that's already CANCELLED, or a
  // CONFIRMED one that's fully in the past -- this only ever touches
  // Venndra's own record, never the calendars themselves, so it's
  // deliberately restricted to events where that's a safe, low-stakes
  // action. Deleting something still upcoming or still being searched for
  // isn't exposed anywhere in the UI, and this guards against it being
  // done anyway (e.g. someone hand-crafting the request).
  const isPast = event.confirmedEnd !== null && event.confirmedEnd < new Date();
  const canDelete = event.status === "CANCELLED" || (event.status === "CONFIRMED" && isPast);
  if (!canDelete) {
    return NextResponse.json({ error: "Only a past or cancelled event can be deleted" }, { status: 409 });
  }

  // Cascades to delete its EventParticipant and EventVote rows too (see
  // the onDelete: Cascade on those relations in schema.prisma) -- nothing
  // extra to clean up manually here.
  await prisma.event.delete({ where: { id: event.id } });

  return NextResponse.json({ ok: true });
}