import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../../../lib/prisma";
import { createUpstreamEvent, deleteUpstreamEvent } from "../../../../../lib/upstreamEvents";
import { jsonBody } from "../../../../../lib/requestBody";
import { currentUser, unauthorized } from "../../../../../lib/session";

const reassignSchema = z.object({ newOrganizerUserId: z.string().min(1) });

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const sessionUser = await currentUser();
  if (!sessionUser) return unauthorized();

  const parsed = reassignSchema.safeParse(await jsonBody(req));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { newOrganizerUserId } = parsed.data;

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    include: { participants: { include: { user: { select: { name: true } } } } },
  });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const userId = sessionUser.id;
  if (event.creatorId !== userId) {
    return NextResponse.json({ error: "Only the event organizer can do this" }, { status: 403 });
  }
  if (event.status !== "SEARCHING" && event.status !== "CONFIRMED") {
    return NextResponse.json({ error: "This event isn't active" }, { status: 400 });
  }
  if (newOrganizerUserId === userId) {
    return NextResponse.json({ error: "You're already the organizer" }, { status: 400 });
  }

  // Never trust that the client only let someone click an eligible row --
  // re-check both that they're a real CONNECTED participant here and,
  // below, that they still have a write-target calendar right now.
  const newOrganizerParticipant = event.participants.find((p) => p.userId === newOrganizerUserId);
  if (!newOrganizerParticipant || newOrganizerParticipant.status !== "CONNECTED") {
    return NextResponse.json({ error: "That person isn't a connected participant on this event" }, { status: 400 });
  }

  const newWriteSource = await prisma.calendarSource.findFirst({
    where: { connectedCalendar: { userId: newOrganizerUserId, isEnabled: true }, isWriteTarget: true },
    include: { connectedCalendar: true },
  });
  if (!newWriteSource) {
    return NextResponse.json(
      { error: "That person doesn't have a calendar set to receive new events yet" },
      { status: 400 }
    );
  }

  if (event.status === "SEARCHING") {
    // Nothing's been written to a calendar yet -- just transfer the role.
    // A stays on as a regular participant (their own EventParticipant row,
    // and any votes, are untouched) -- they're free to leave separately
    // afterward via the normal "Leave this event" action if they want to.
    const updated = await prisma.event.update({
      where: { id: event.id },
      data: { creatorId: newOrganizerUserId },
    });
    return NextResponse.json({ event: updated });
  }

  // CONFIRMED: real calendar surgery. Create on C's calendar first -- if
  // that fails, nothing has been destroyed yet and we can just fail clean
  // with the old event still intact on A's calendar.
  if (!event.writeCalendarSourceId || !event.confirmedStart || !event.confirmedEnd) {
    return NextResponse.json({ error: "This event has no confirmed time to transfer" }, { status: 400 });
  }

  // A stays a participant through the transfer (unlike the old "leave and
  // hand off" behavior), so they belong on the new invite same as anyone
  // else -- no filtering out the departing organizer here anymore.
  // Mirrors confirm/route.ts's attendeeEmails filter -- the new organizer's
  // own email isn't included as an attendee since it's implicitly the
  // calendar owner. Apple has no real attendee list, so its branch below
  // uses event.participants as-is instead.
  const attendeeEmails = event.participants
    .map((p) => p.email)
    .filter((email) => email !== newOrganizerParticipant.email);

  // lib/upstreamEvents, shared with confirm/route.ts, which creates the very
  // same event when a slot is first picked. This route used to carry its own
  // copy of the three-provider create -- same branches, same argument shape,
  // same Apple special case (#30). That block is the one lib/upstreamEvents
  // exists to stop being duplicated: three APIs, three sets of quirks, and a
  // fix applied to one copy is a bug still live in the other.
  //
  // The helper throws rather than swallowing, and this route catches, because
  // here a failure has to be reported as "nothing was changed" -- the old
  // event is still standing on the previous organizer's calendar at this
  // point, and that is a fact the user needs. confirm lets the same throw
  // propagate, for its own reasons. That divergence is why the try stays here
  // rather than moving into the helper.
  let created;
  try {
    created = await createUpstreamEvent(newWriteSource, {
      title: event.title,
      description: event.description,
      location: event.location,
      start: event.confirmedStart,
      end: event.confirmedEnd,
      attendeeEmails,
      // Apple has no attendee list, so the names go in a plain-text
      // DESCRIPTION instead -- everyone, unlike attendeeEmails above, which
      // leaves out the new organizer as the calendar's owner.
      participants: event.participants.map((p) => ({ email: p.email, name: p.user?.name ?? null })),
    });
  } catch (err) {
    console.error("Failed to create event on the new organizer's calendar during reassign:", err);
    return NextResponse.json(
      { error: "Couldn't create this event on their calendar -- nothing was changed." },
      { status: 500 }
    );
  }
  if (!created) {
    return NextResponse.json({ error: "That calendar type doesn't support creating events yet" }, { status: 400 });
  }

  // Best-effort cleanup of the old event -- the transfer already succeeded on
  // C's calendar at this point, so don't block on this, the same way
  // cancel/route.ts and leave/route.ts don't block on their own deletes.
  //
  // `event` still describes the OLD calendar here: writeCalendarSourceId,
  // externalEventId and the Apple href/etag are all overwritten by the update
  // below, not before it, so the helper resolves exactly the source this
  // route's own copy used to look up by hand. Its CONFIRMED guard is already
  // discharged by the SEARCHING branch that returned above.
  //
  // The one real difference: that lookup used to happen before the create and
  // now happens after it, because the helper does its own. So if the old
  // CalendarSource row disappears during the create's round trip, this skips
  // rather than calling a provider with a source that no longer exists. Both
  // end with the old event still standing and nothing raised -- the previous
  // code would have thrown into its own catch -- and skipping is the more
  // honest of the two.
  await deleteUpstreamEvent(event, "reassign");

  // A's own EventParticipant/EventVote rows are left untouched throughout --
  // they remain a regular participant after the transfer, free to leave
  // separately afterward via the normal "Leave this event" action if they
  // want to.
  const updated = await prisma.event.update({
    where: { id: event.id },
    data: {
      creatorId: newOrganizerUserId,
      writeCalendarSourceId: newWriteSource.id,
      externalEventId: created.externalEventId,
      externalEventHref: created.externalEventHref ?? null,
      externalEventEtag: created.externalEventEtag,
      writeError: null,
    },
  });

  return NextResponse.json({ event: updated });
}
