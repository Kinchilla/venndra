import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import { recordKnownContacts } from "../../../lib/knownContacts";
import { validateAllFriends } from "../../../lib/friends";

const groupSchema = z.object({
  name: z.string().min(1).max(60),
  emails: z.array(z.string().email()).min(1).max(50),
  defaultFilters: z.record(z.array(z.tuple([z.string(), z.string()]))).optional(),
});

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const groups = await prisma.savedGroup.findMany({
    where: { userId: (session.user as any).id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ groups });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = groupSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const userId = (session.user as any).id;
  if (!session.user.email) return NextResponse.json({ error: "Account has no email on file" }, { status: 400 });

  const friendError = await validateAllFriends(userId, session.user.email, parsed.data.emails);
  if (friendError) return NextResponse.json({ error: friendError }, { status: 400 });

  const group = await prisma.savedGroup.create({
    data: { ...parsed.data, userId },
  });

  await recordKnownContacts(userId, parsed.data.emails);

  return NextResponse.json({ group }, { status: 201 });
}
