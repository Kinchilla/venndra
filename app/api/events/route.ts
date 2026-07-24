import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { fromZonedTime } from "date-fns-tz";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import { recordKnownContacts } from "../../../lib/knownContacts";
import { validateAllFriends } from "../../../lib/friends";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const eventSchema = z
  .object({
    title: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    location: z.string().max(200).optional(),
    durationMin: z.number().int().min(5).max(1440),
    searchStart: dateOnly,
    searchEnd: dateOnly,
    timezone: z.string().min(1),
    filters: z.record(z.array(z.tuple([z.string(), z.string()]))).default({}),
    minAttendees: z.number().int().min(1).optional(),
    votingEnabled: z.boolean().default(false),
    voteTopX: z.number().int().min(1).max(10).optional(),
    emails: z.array(z.string().email()).min(1).max(50), // whoever's invited, including the creator if they chose to keep themselves in it
  })
  .refine((data) => data.searchEnd >= data.searchStart, {
    message: "End date can't be before the start date",
    path: ["searchEnd"],
  });

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as any).id;
  const userEmail = session.user.email;

  const events = await prisma.event.findMany({
    where: {
      OR: [{ creatorId: userId }, { participants: { some: { email: userEmail ?? "" } } }],
    },
    include: { participants: true, creator: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ events });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = eventSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const userId = (session.user as any).id;
  const creator = await prisma.user.findUnique({ where: { id: userId } });
  if (!creator?.email) return NextResponse.json({ error: "Account has no email on file" }, { status: 400 });

  // Every invited email gets a participant row. If it already matches an
  // existing user with at least one connected calendar, mark them
  // CONNECTED immediately; otherwise they start as INVITED until they sign
  // in and connect a calendar via the join link. The creator is only
  // included if the client included them -- the "new event" form defaults
  // to pre-filling the creator's own email, but they're free to remove it.
  const allEmails = Array.from(new Set(parsed.data.emails));

  // Every invited email (other than the creator's own) must belong to an
  // accepted friend -- the picker UI already only offers friends, but this
  // is the actual enforcement point, since a raw API request could
  // otherwise bypass the UI entirely.
  const friendError = await validateAllFriends(userId, creator.email, allEmails);
  if (friendError) return NextResponse.json({ error: friendError }, { status: 400 });

  const existingUsers = await prisma.user.findMany({
    where: { email: { in: allEmails } },
    include: { connectedCalendars: { where: { isEnabled: true }, take: 1 } },
  });
  const userByEmail = new Map(existingUsers.map((u) => [u.email!, u]));

  const { emails, searchStart, searchEnd, timezone, ...eventData } = parsed.data;

  const event = await prisma.event.create({
    data: {
      ...eventData,
      timezone,
      // stored as real UTC instants, anchored to midnight in the
      // creator's own timezone, matching how slot generation already
      // interprets day/time filters elsewhere in lib/availability.ts
      searchStart: fromZonedTime(`${searchStart}T00:00:00`, timezone),
      searchEnd: fromZonedTime(`${searchEnd}T00:00:00`, timezone),
      creatorId: userId,
      participants: {
        create: allEmails.map((email) => {
          const match = userByEmail.get(email);
          const isConnected = !!match && match.connectedCalendars.length > 0;
          return {
            email,
            userId: match?.id,
            status: isConnected ? "CONNECTED" : "INVITED",
          };
        }),
      },
    },
    include: { participants: true },
  });

  await recordKnownContacts(userId, allEmails);

  return NextResponse.json({ event }, { status: 201 });
}
