import crypto from "crypto";
import { sendEmail } from "./email";
import { checkRateLimit } from "./rateLimit";

/**
 * Feature ideas and bug reports from the footer's feedback form.
 *
 * Submissions are emailed to a private inbox and go nowhere else -- not to the
 * public issue tracker, not to any storage bucket. That is the whole reason the
 * opt-in screenshot below is allowed to exist: see the note on `screenshot`.
 *
 * Accepts submissions from signed-out visitors on purpose. Venndra's auth is
 * magic links and OAuth, so the most likely severe bug is "I can't sign in" --
 * a form that required signing in would be unreachable in exactly the case that
 * matters most.
 */

const SUBMIT_LIMIT_PER_MINUTE = 3;

/** Above this, the screenshot is dropped rather than the submission refused. */
const MAX_SCREENSHOT_BYTES = 3_000_000;

/**
 * Where submissions go.
 *
 * Read from the environment and never written down in this repository, which
 * is public -- a plaintext address on an indexed page is a standing invitation
 * to scrapers. Same reasoning that kept it out of issue #15 when it was filed.
 */
export function feedbackInbox(): string | null {
  return process.env.FEEDBACK_TO || null;
}

/** False when the deployment has no inbox configured, which hides the form. */
export function feedbackConfigured(): boolean {
  return feedbackInbox() !== null;
}

/**
 * What the page told us about itself, captured client-side at submit time.
 *
 * Always sent, unlike the screenshot -- it is the difference between "something
 * broke" and a report somebody can act on, and it carries no pixels.
 */
export type PageState = {
  /** The full URL, path and query. May contain event or group ids. */
  url: string;
  /** "375x812" -- the CSS viewport, which is what layout bugs are reported against. */
  viewport: string;
  userAgent: string;
};

export type FeedbackSubmission = {
  kind: "bug" | "idea";
  message: string;
  /** Optional: the form is open to signed-out visitors, so there may be no other way to reply. */
  replyTo: string | null;
  page: PageState;
  /**
   * A rasterization of the DOM at submit time, or null.
   *
   * Only ever present when the reporter ticked the box. That consent covers the
   * reporter, but NOT the third parties whose names may be on their screen --
   * friends lists, event participants. What bounds that exposure is the
   * destination being a private inbox, which is why the checkbox and the
   * private inbox are a pair rather than two independent choices. Anything that
   * would republish this (an auto-filed public issue, a storage bucket with a
   * guessable URL) breaks the pairing and is not a small change.
   */
  screenshot: Buffer | null;
};

/**
 * Who the rate limit counts against.
 *
 * Hashed rather than stored raw, and salted with a secret the deployment
 * already has: a bare SHA-256 of an IPv4 address is not anonymised at all --
 * the whole address space is four billion values, which is minutes of work to
 * enumerate. The salt is what makes the digest meaningless without it.
 *
 * Falls back to a constant when there's no forwarded IP, which makes every
 * such caller share one bucket. That is deliberately the strict direction: a
 * local request with no proxy header is the developer, and an anonymous caller
 * we cannot distinguish should be throttled together rather than waved through
 * individually.
 */
export function rateLimitSubject(userId: string | null, forwardedFor: string | null): string {
  if (userId) return userId;

  // x-forwarded-for is a comma-separated chain; the client is the first entry.
  const ip = forwardedFor?.split(",")[0]?.trim();
  if (!ip) return "anon:unknown";

  const salt = process.env.NEXTAUTH_SECRET ?? "";
  return `anon:${crypto.createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32)}`;
}

export type SubmitResult = { ok: true } | { ok: false; error: string; status: number };

export async function submitFeedback(
  submission: FeedbackSubmission,
  context: { userId: string | null; userEmail: string | null; subject: string }
): Promise<SubmitResult> {
  const inbox = feedbackInbox();
  if (!inbox) {
    return { ok: false, error: "Feedback isn't configured on this deployment.", status: 503 };
  }

  const allowed = await checkRateLimit("feedback", context.subject, SUBMIT_LIMIT_PER_MINUTE);
  if (!allowed) {
    return { ok: false, error: "That's a few in quick succession — try again in a minute.", status: 429 };
  }

  // Dropped rather than refused: someone who wrote a paragraph about a bug
  // shouldn't lose it because their screen rasterised larger than expected.
  // The words are the submission; the image was always the optional half.
  const screenshot =
    submission.screenshot && submission.screenshot.length <= MAX_SCREENSHOT_BYTES ? submission.screenshot : null;
  const screenshotDropped = submission.screenshot !== null && screenshot === null;

  const label = submission.kind === "bug" ? "Bug report" : "Feature idea";
  const facts: [string, string][] = [
    ["Page", submission.page.url],
    ["Viewport", submission.page.viewport],
    ["Browser", submission.page.userAgent],
    ["Submitted", new Date().toISOString()],
    ["Signed in as", context.userEmail ? `${context.userEmail} (${context.userId})` : "not signed in"],
    ["Reply to", submission.replyTo ?? "not given"],
    ["Screenshot", screenshot ? "attached" : screenshotDropped ? "too large, dropped" : "not included"],
  ];

  await sendEmail({
    to: inbox,
    subject: `[Venndra ${submission.kind}] ${firstLine(submission.message)}`,
    text: `${label}\n\n${submission.message}\n\n---\n${facts.map(([k, v]) => `${k}: ${v}`).join("\n")}\n`,
    html: feedbackHtml(label, submission.message, facts),
    ...(screenshot ? { attachments: [{ filename: "screenshot.jpg", content: screenshot }] } : {}),
  });

  return { ok: true };
}

/**
 * The subject line, so the inbox is skimmable without opening anything.
 *
 * Truncated on a word boundary where possible -- a subject cut mid-word reads
 * as a broken send rather than a long message.
 */
function firstLine(message: string): string {
  const line = message.trim().split("\n")[0];
  if (line.length <= 60) return line;
  const cut = line.slice(0, 60);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 30 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function feedbackHtml(label: string, message: string, facts: [string, string][]): string {
  const rows = facts
    .map(
      ([k, v]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#231F20;opacity:.55;white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td>` +
        `<td style="padding:2px 0;color:#231F20;word-break:break-word">${escapeHtml(v)}</td></tr>`
    )
    .join("");

  return [
    `<div style="font-family:system-ui,sans-serif;color:#231F20;max-width:640px">`,
    `<p style="margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.08em;opacity:.5">${escapeHtml(label)}</p>`,
    // white-space:pre-wrap so the reporter's own line breaks survive -- a bug
    // report written as numbered steps is much harder to follow as one blob.
    `<div style="white-space:pre-wrap;font-size:15px;line-height:1.5;margin:0 0 20px">${escapeHtml(message)}</div>`,
    `<table style="font-size:12px;border-top:1px solid #E4DDD0;padding-top:12px;width:100%">${rows}</table>`,
    `</div>`,
  ].join("");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
