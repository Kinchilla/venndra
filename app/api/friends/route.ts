import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../lib/prisma";
import { emailField } from "../../../lib/emailIdentity";
import { checkRateLimit } from "../../../lib/rateLimit";
import { jsonBody } from "../../../lib/requestBody";
import { loadFriendLists } from "../../../lib/friends";
import { currentUser, unauthorized } from "../../../lib/session";
import { notifyUser } from "../../../lib/notifications/send";
import { friendRequestReceivedEmail, friendRequestAcceptedEmail } from "../../../lib/notifications/templates";

export async function GET() {
  const sessionUser = await currentUser();
  if (!sessionUser) return unauthorized();

  // Shared with app/friends/page.tsx, which renders the same three lists
  // server-side (#30). The response shape is unchanged: same keys, same
  // `friendshipId`, same user fields, same order.
  return NextResponse.json(await loadFriendLists(sessionUser.id));
}

// Two ways to name the person you're adding, and the difference is issue #6.
//
// `email` is the add-a-friend form: you type an address you already know, and
// it's the only thing you have to go on. emailField, not z.string().email():
// the address is about to be used as a lookup key, and typing a friend's
// address the way it appears in their signature -- "Friend@gmail.com" -- used
// to return "No Venndra profile found for this email yet" for someone who
// plainly had one. Issue #25.
//
// `userId` is Suggested Friends, and it exists so that flow can stop being
// handed addresses. Suggestions are friends-of-friends -- people you have
// never met and whose email you have no business receiving -- but requesting
// one used to mean POSTing their address, so the suggestions endpoint had to
// send it to the browser first. Hiding it in the markup would have changed
// nothing: it was in the JSON. Accepting an id instead is what let
// app/api/friends/suggestions stop selecting the column at all.
//
// A cuid is not a secret, but it isn't guessable either, and it discloses
// nothing on its own -- which is the whole difference from an address.
const requestSchema = z.union([
  z.object({ email: emailField }),
  z.object({ userId: z.string().min(1) }),
]);

export async function POST(req: NextRequest) {
  const sessionUser = await currentUser();
  if (!sessionUser) return unauthorized();
  const userId = sessionUser.id;

  // Limited because of who bears the cost, not what it costs us. Every one of
  // these puts something in front of another person, and declining a request
  // deletes the row (the DELETE in app/api/friends/[id]) -- so the 409 below
  // that stops you sending the same request twice does nothing to stop you
  // sending it again the moment it is declined. Nothing on the receiving side
  // stops the next one arriving. Issue #41.
  //
  // Keyed on the requester, which covers both shapes of that: re-requesting
  // one person in a loop, and spraying many. Ten a minute is far above anyone
  // adding friends by hand -- the form takes one typed address per request --
  // and far below a script.
  const allowed = await checkRateLimit("friend-request", userId, 10);
  if (!allowed) {
    return NextResponse.json({ error: "Too many friend requests — wait a moment and try again." }, { status: 429 });
  }

  const parsed = requestSchema.safeParse(await jsonBody(req));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });

  const target = await prisma.user.findUnique({
    where: "userId" in parsed.data ? { id: parsed.data.userId } : { email: parsed.data.email },
  });
  if (!target) {
    // Worded to match the inline hint on the add-friend form exactly
    // (components/NewFriendForm) -- that check runs as you type and this one
    // fires if you submit anyway, so the same fact used to arrive twice in two
    // different sentences. Change one and change the other. The address isn't
    // interpolated any more: the only caller has it in a field on screen.
    //
    // The id branch reaches this only if a suggestion went stale between being
    // listed and being clicked -- the account was deleted in between. Same
    // 404, and the wording is odd for that case but it is not a case anyone
    // sees: the chip disappears on the refetch either way.
    return NextResponse.json({ error: "No Venndra profile found for this email yet" }, { status: 404 });
  }
  if (target.id === userId) {
    return NextResponse.json({ error: "You can't add yourself as a friend." }, { status: 400 });
  }

  // Check the reverse direction first -- if they already requested you,
  // this action should just complete that request rather than create a
  // second, conflicting row.
  const reverse = await prisma.friendship.findUnique({
    where: { requesterId_addresseeId: { requesterId: target.id, addresseeId: userId } },
  });
  if (reverse) {
    if (reverse.status === "ACCEPTED") {
      return NextResponse.json({ error: "You're already friends." }, { status: 409 });
    }
    const updated = await prisma.friendship.update({ where: { id: reverse.id }, data: { status: "ACCEPTED" } });
    // `target` sent the original request that this just auto-completes --
    // it's their acceptance to hear about, not the current user's. Awaited,
    // not fired-and-forgotten: a serverless function can be frozen the
    // instant the response goes out, and notifyUser already can't fail this
    // request (it never throws -- see lib/notifications/send.ts).
    await notifyUser(target.id, "friend_request_accepted", () => friendRequestAcceptedEmail(sessionUser));
    return NextResponse.json({ friendship: updated, autoAccepted: true });
  }

  const existing = await prisma.friendship.findUnique({
    where: { requesterId_addresseeId: { requesterId: userId, addresseeId: target.id } },
  });
  if (existing) {
    return NextResponse.json(
      { error: existing.status === "ACCEPTED" ? "You're already friends." : "You've already sent a request to this person." },
      { status: 409 }
    );
  }

  const friendship = await prisma.friendship.create({
    data: { requesterId: userId, addresseeId: target.id, status: "PENDING" },
  });
  await notifyUser(target.id, "friend_request_received", () => friendRequestReceivedEmail(sessionUser));
  return NextResponse.json({ friendship }, { status: 201 });
}