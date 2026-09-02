import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { redeemPhoneToken } from "../../../../../lib/phoneVerification";
import { jsonBody } from "../../../../../lib/requestBody";
import { currentUser, unauthorized } from "../../../../../lib/session";

/**
 * Redeem a verification token.
 *
 * POST, never GET, and that is the whole point of it being a separate route
 * from the page the link opens.
 *
 * The link in the text is a GET, and things other than the recipient follow
 * GETs: carrier link-scanners and messaging-app previewers fetch URLs out of
 * incoming texts before a human ever sees them. If opening the URL verified
 * the number, those fetches would verify it -- so the flow would confirm that
 * a message reached a handset, which is not the same as confirming that the
 * person who typed the number is the person holding it. /verify-phone renders
 * a page with a button; only pressing it reaches here.
 */
export async function POST(req: NextRequest) {
  const sessionUser = await currentUser();
  if (!sessionUser) return unauthorized();

  const parsed = z.object({ token: z.string().min(1).max(64) }).safeParse(await jsonBody(req));
  if (!parsed.success) return NextResponse.json({ error: "That link is missing its code." }, { status: 400 });

  const result = await redeemPhoneToken(parsed.data.token, sessionUser.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true, phone: result.phone });
}
