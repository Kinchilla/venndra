import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "../../../lib/auth";
import { rateLimitSubject, submitFeedback } from "../../../lib/feedback";

/**
 * Feature ideas and bug reports from the footer form.
 *
 * The one route in the app that does real work for a signed-out caller, which
 * is the point -- see the note at the top of lib/feedback.ts. A session is read
 * if there is one, for attribution, but never required.
 */

// Base64 inflates by about a third, so this ceiling is roughly the 3MB of
// decoded image lib/feedback.ts will actually attach. Both exist: this one
// stops an oversized body being parsed at all, that one decides what to do with
// an image that survived parsing.
const MAX_SCREENSHOT_BASE64 = 4_200_000;

const submitSchema = z.object({
  kind: z.enum(["bug", "idea"]),
  message: z.string().trim().min(1).max(5000),
  // Validated as an address only when non-empty: the field is optional, and
  // an empty string is "didn't fill it in", not a malformed address.
  replyTo: z.string().trim().max(200).email().nullable().or(z.literal("")),
  page: z.object({
    url: z.string().max(2000),
    viewport: z.string().max(40),
    userAgent: z.string().max(500),
  }),
  /** Raw base64, no data: prefix -- the client strips it before sending. */
  screenshot: z.string().max(MAX_SCREENSHOT_BASE64).nullable(),
  /**
   * The honeypot. A real person never sees this field, so anything in it came
   * from something filling in every input it could find. Named to look worth
   * completing rather than "honeypot", since the naive bots this catches are
   * reading the name.
   */
  website: z.string().max(200).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = submitSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "That didn't look like a complete submission." }, { status: 400 });
  }

  // Answered exactly as a real submission would be. Telling a bot it was
  // spotted just tells whoever wrote it which field to leave alone next time,
  // and there is no user on the other end of this to mislead.
  if (parsed.data.website) return NextResponse.json({ ok: true });

  const session = await getServerSession(authOptions);
  const userId = session?.user ? ((session.user as any).id as string) : null;

  const result = await submitFeedback(
    {
      kind: parsed.data.kind,
      message: parsed.data.message,
      replyTo: parsed.data.replyTo || null,
      page: parsed.data.page,
      screenshot: parsed.data.screenshot ? Buffer.from(parsed.data.screenshot, "base64") : null,
    },
    {
      userId,
      userEmail: session?.user?.email ?? null,
      subject: rateLimitSubject(userId, req.headers.get("x-forwarded-for")),
    }
  );

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
