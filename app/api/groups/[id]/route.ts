import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "../../../../lib/auth";
import { prisma } from "../../../../lib/prisma";
import { recordKnownContacts } from "../../../../lib/knownContacts";

const groupSchema = z.object({
  name: z.string().min(1).max(60),
  emails: z.array(z.string().email()).min(1).max(50),
  defaultFilters: z.record(z.array(z.tuple([z.string(), z.string()]))).optional(),
});

async function getOwnedGroup(id: string, userId: string) {
  const group = await prisma.savedGroup.findUnique({ where: { id } });
  if (!group || group.userId !== userId) return null;
  return group;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const group = await getOwnedGroup(params.id, (session.user as any).id);
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ group });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await getOwnedGroup(params.id, (session.user as any).id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = groupSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // Deliberately does NOT touch any Event already created from this group --
  // events capture their own participant list at creation time, so editing
  // a group later never reshuffles who's invited to a search already in
  // progress. See README.
  const group = await prisma.savedGroup.update({ where: { id: params.id }, data: parsed.data });

  await recordKnownContacts((session.user as any).id, parsed.data.emails);

  return NextResponse.json({ group });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await getOwnedGroup(params.id, (session.user as any).id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.savedGroup.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
