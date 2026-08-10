import { Resend } from "resend";

/**
 * Transactional email, via Resend.
 *
 * Resend was already a dependency (and RESEND_API_KEY already an optional env
 * var) but nothing in the app actually sent anything until magic-link sign-in
 * needed to. It stays a single choke point on purpose: every outbound email
 * goes through send(), so "what does Venndra email people about" has one
 * answer you can read.
 *
 * The client is built lazily rather than at module load. `lib/auth.ts` imports
 * this file, and `lib/auth.ts` is imported by essentially every page and route
 * in the app -- constructing a Resend client at import time would make a
 * missing API key a crash on every request, including ones that never send
 * anything.
 */

let client: Resend | null = null;

function getClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!client) client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

/**
 * The From: address, and the single place EMAIL_FROM is read.
 *
 * Must be on a domain verified in Resend or sends are rejected. The fallback
 * is Resend's sandbox sender, which only delivers to the address that owns
 * the Resend account -- fine for development, useless for real users.
 */
export function fromAddress(): string {
  return process.env.EMAIL_FROM ?? "Venndra <onboarding@resend.dev>";
}

export type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

/**
 * Sends one email, or throws.
 *
 * Throwing (rather than returning a status) is deliberate: the one caller so
 * far is NextAuth's sendVerificationRequest, whose contract is that a throw
 * means "don't tell the user their link is on the way." Swallowing a failure
 * there would show a cheerful "check your email" page for a mail that was
 * never sent, and the user would sit waiting for it.
 *
 * With no RESEND_API_KEY set, behaviour splits by environment on purpose:
 *   - development: log the message and carry on, so local sign-in works
 *     without a Resend account or a verified domain. The magic-link URL lands
 *     in the terminal, which is enough to click through.
 *   - production: throw. A deployment quietly not sending its sign-in emails
 *     is the kind of failure that looks fine in every dashboard while nobody
 *     can get in, so it fails loudly instead.
 */
export async function sendEmail({ to, subject, html, text }: SendEmailParams): Promise<void> {
  const resend = getClient();

  if (!resend) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("RESEND_API_KEY is not set, so no email could be sent.");
    }
    // eslint-disable-next-line no-console
    console.log(`\n--- email (dev, not actually sent) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n---\n`);
    return;
  }

  // Resend's v3 SDK resolves rather than rejects on an API-level failure --
  // a bad key or an unverified From: domain comes back as { error }, not as a
  // thrown exception. Without this check a rejected send would look exactly
  // like a successful one.
  const { error } = await resend.emails.send({ from: fromAddress(), to, subject, html, text });
  if (error) {
    throw new Error(`Resend refused the message: ${error.message ?? JSON.stringify(error)}`);
  }
}
