import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../../lib/auth";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../../lib/prisma";
import { validateAllFriends } from "../../../../lib/friends";
import { savedGroupSchema } from "../../../../lib/savedGroupSchema";
import { jsonBody } from "../../../../lib/requestBody";

async function getOwnedGroup(id: string, userId: string) {
  const group = await prisma.savedGroup.findUnique({ where: { id } });
  if (!group || group.userId !== userId) return null;
  return group;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const group = await getOwnedGroup(params.id, session.user.id);
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ group });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await getOwnedGroup(params.id, session.user.id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = savedGroupSchema.safeParse(await jsonBody(req));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (!session.user.email) return NextResponse.json({ error: "Account has no email on file" }, { status: 400 });
  const friendError = await validateAllFriends(session.user.id, session.user.email, parsed.data.emails);
  if (friendError) return NextResponse.json({ error: friendError }, { status: 400 });

  // Deliberately does NOT touch any Event already created from this group --
  // events capture their own participant list at creation time, so editing
  // a group later never reshuffles who's invited to a search already in
  // progress. See README.
  // An omitted defaultFilters leaves the existing window alone; an explicit
  // null clears it (Prisma needs DbNull rather than a bare null for Json?
  // columns -- see the create route for the DbNull/JsonNull distinction).
  const { defaultFilters, ...rest } = parsed.data;
  const group = await prisma.savedGroup.update({
    where: { id: params.id },
    data: {
      ...rest,
      ...(defaultFilters === undefined ? {} : { defaultFilters: defaultFilters ?? Prisma.DbNull }),
    },
  });

  return NextResponse.json({ group });
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await getOwnedGroup(params.id, session.user.id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.savedGroup.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
