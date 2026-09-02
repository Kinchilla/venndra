import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import { upcomingConfirmedWhere } from "../../../lib/eventLifecycle";
import { deleteUpstreamEvent, removeAttendeeFromUpstreamEvent, UpstreamEvent } from "../../../lib/upstreamEvents";
import { normalizeEmail } from "../../../lib/emailIdentity";
import { forgetRateLimitSubjects } from "../../../lib/rateLimit";
import { weeklyHoursSchema } from "../../../lib/searchWindowSchema";
import { jsonBody } from "../../../lib/requestBody";

const schema = z.object({
  // Trimmed, and an empty result becomes null rather than "".
  //
  // Both halves matter. A whitespace-only name reads as set to every
  // `!= null` test in the app: it would silence components/DisplayNameBanner
  // while leaving the person just as unidentifiable as before, which is the
  // one outcome issue #18 is trying to avoid.
  //
  // And clearing the field has to be allowed to mean something, because a
  // display name is optional here by design -- someone who doesn't mind
  // friends seeing their address shouldn't have to invent a name to get past
  // a validator. Rejecting "" instead would have trapped exactly the people
  // who have no name yet: the field sits in the same form as the timezone, so
  // a hard reject would have blocked them from saving an unrelated setting
  // until they gave in and named themselves.
  name: z
    .string()
    .max(80)
    .transform((v) => v.trim() || null)
    .nullable()
    .optional(),
  timezone: z.string().min(1).optional(),
  // `null` is a meaningful, explicit value here (not just "field omitted") --
  // it's how the Settings page's "Reset to app default" button clears a
  // previously saved default.
  defaultSearchFilters: weeklyHoursSchema.nullable().optional(),
});

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await jsonBody(req));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // Prisma's Json? fields treat a plain JS `null` as ambiguous -- it can't
  // tell "clear this field" apart from "field wasn't sent at all" the same
  // way it can for ordinary nullable columns. Prisma.JsonNull is the
  // required sentinel for an explicit "set this JSON column to NULL" --
  // needed here since "Reset to app default" sends defaultSearchFilters:
  // null on purpose, not just omits it.
  const { defaultSearchFilters, ...rest } = parsed.data;
  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: {
      ...rest,
      ...(defaultSearchFilters !== undefined && {
        defaultSearchFilters: defaultSearchFilters === null ? Prisma.JsonNull : defaultSearchFilters,
      }),
    },
  });

  return NextResponse.json({
    user: {
      name: user.name,
      timezone: user.timezone,
      image: user.image,
      defaultSearchFilters: user.defaultSearchFilters,
    },
  });
}

/** The fields lib/upstreamEvents needs, and nothing else. */
const UPSTREAM_EVENT_SELECT = {
  id: true,
  status: true,
  description: true,
  writeCalendarSourceId: true,
  externalEventId: true,
  externalEventHref: true,
  externalEventEtag: true,
} as const;

/**
 * Delete the signed-in account, permanently.
 *
 * The order below is the whole design, because only the first half can fail
 * in a way nobody would ever find out about. Real calendars are touched
 * FIRST, while the Venndra rows describing them still exist -- once the user
 * row is gone, so is every credential needed to reach a provider, and any
 * event left standing out there would be unreachable forever.
 *
 *   1. Every upcoming event they ORGANIZE is cancelled at the provider, so
 *      the people they'd invited get a real cancellation notice rather than
 *      watching an event silently disappear from Venndra while it sits on
 *      their calendar all week. Past events are left alone -- they already
 *      happened, and rewriting history isn't what deleting an account means.
 *   2. Every upcoming event they merely JOINED has them taken off the actual
 *      invite, exactly as if they'd hit "Leave this event" on each one. The
 *      event itself carries on for everyone else.
 *   3. Then the database work, in one transaction: their participant rows,
 *      their address out of other people's saved groups, and finally the
 *      user itself.
 *
 * Step 3's last statement does most of the work by cascade (see the
 * onDelete: Cascade relations in prisma/schema.prisma): sessions, OAuth
 * Accounts -- which is what "releases" a connected Google/Microsoft account
 * to be used for a fresh Venndra signup -- connected calendars and their
 * sources and stored iCloud password, saved groups, friendships in both
 * directions, dismissed suggestions, and every event they created. The
 * statements before it exist precisely because they are the things NO
 * cascade covers: EventParticipant links to User optionally, so it would be
 * left holding a null userId and their email forever, SavedGroup.emails
 * is a plain string array with no foreign key at all, and RateLimitState is
 * keyed by a bare string with no relation to anything -- which for the
 * magic-link limiter means a row whose key IS the address being erased.
 */
export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const email = session.user.email;

  // 1. Cancel what they were running. Sequential rather than Promise.all:
  // several of these can share one connected calendar, and hammering a
  // provider with parallel deletes is how you turn a clean cancellation into
  // a rate-limited one.
  const organized: UpstreamEvent[] = await prisma.event.findMany({
    where: { creatorId: userId, OR: [{ status: "SEARCHING" }, upcomingConfirmedWhere()] },
    select: UPSTREAM_EVENT_SELECT,
  });
  for (const event of organized) {
    await deleteUpstreamEvent(event);
  }

  // 2. Step off what they'd joined. Scoped to events someone ELSE organizes
  // -- their own are being deleted wholesale above, so removing themselves
  // from an invite that's about to stop existing is wasted provider calls.
  if (email) {
    const joined = await prisma.eventParticipant.findMany({
      where: {
        email,
        event: { creatorId: { not: userId }, ...upcomingConfirmedWhere() },
      },
      select: { id: true, email: true, event: { select: UPSTREAM_EVENT_SELECT } },
    });
    for (const participant of joined) {
      await removeAttendeeFromUpstreamEvent(participant.event, { id: participant.id, email: participant.email });
    }
  }

  // 3. Now the database. One transaction, so a failure part-way through
  // can't leave a half-deleted account that can still sign in.
  await prisma.$transaction([
    // Matched on userId as well as email: the two agree today, but a row
    // linked only by id (or only by address) should still go.
    prisma.eventParticipant.deleteMany({
      where: email ? { OR: [{ userId }, { email }] } : { userId },
    }),
    // Saved groups store bare addresses in a text[], so this is the one
    // place a hand-written UPDATE beats anything Prisma can express.
    ...(email
      ? [
          prisma.$executeRaw`UPDATE "SavedGroup" SET emails = array_remove(emails, ${email}::text) WHERE emails && ARRAY[${email}::text]`,
          // A group that was only ever this one person is now a group of
          // nobody, which the group form can't represent and applying to an
          // event would silently empty the guest list. Cleaner to drop it.
          prisma.$executeRaw`DELETE FROM "SavedGroup" WHERE cardinality(emails) = 0`,
        ]
      : []),
    // Keyed by a bare string, so no cascade reaches these. Both identifiers
    // are passed because the limiters disagree about what they count per:
    // most key on the user id, magic-link keys on the address, and that last
    // one is the row that would otherwise leave a deleted account's email
    // address sitting in the database indefinitely.
    forgetRateLimitSubjects(email ? [userId, normalizeEmail(email)] : [userId]),
    prisma.user.delete({ where: { id: userId } }),
  ]);

  return NextResponse.json({ ok: true });
}
