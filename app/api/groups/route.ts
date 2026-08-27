import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "../../../lib/auth";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { validateAllFriends } from "../../../lib/friends";
import { emailListField } from "../../../lib/emailIdentity";
import { checkRateLimit } from "../../../lib/rateLimit";

const groupSchema = z.object({
  name: z.string().min(1).max(60),
  // Normalised and de-duplicated -- see lib/emailIdentity.
  emails: emailListField,
  // Nullable, not just optional: null is how the client says "this group
  // has no search window", which has to be distinguishable from the field
  // simply being absent.
  defaultFilters: z.record(z.array(z.tuple([z.string(), z.string()]))).nullable().optional(),
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

  // Same write-amplification guard as event creation, and nothing more: a
  // saved group is private to its owner and notifies nobody. Issue #41.
  const allowed = await checkRateLimit("group-create", userId, 10);
  if (!allowed) {
    return NextResponse.json({ error: "Too many groups created — wait a moment and try again." }, { status: 429 });
  }

  const friendError = await validateAllFriends(userId, session.user.email, parsed.data.emails);
  if (friendError) return NextResponse.json({ error: friendError }, { status: 400 });

  // Prisma won't take a bare `null` for a Json? column -- it needs DbNull to
  // mean "SQL NULL" (as opposed to JsonNull, which stores the JSON value
  // `null`). Only DbNull reads back as null, which is what hasSearchWindow and
  // the group-applying code check for.
  const { defaultFilters, ...rest } = parsed.data;
  const group = await prisma.savedGroup.create({
    data: { ...rest, userId, defaultFilters: defaultFilters ?? Prisma.DbNull },
  });

  return NextResponse.json({ group }, { status: 201 });
}
