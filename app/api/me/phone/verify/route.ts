import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "../../../../../lib/auth";
import { redeemPhoneToken } from "../../../../../lib/phoneVerification";

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
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = z.object({ token: z.string().min(1).max(64) }).safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "That link is missing its code." }, { status: 400 });

  const result = await redeemPhoneToken(parsed.data.token, (session.user as any).id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true, phone: result.phone });
}
