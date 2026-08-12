import type { EmailConfig, SendVerificationRequestParams } from "next-auth/providers/email";
import { fromAddress, sendEmail } from "./email";
import { checkRateLimit } from "./rateLimit";

/**
 * Sign in with just an email address -- NextAuth's "email" provider type,
 * assembled by hand rather than imported from `next-auth/providers/email`.
 *
 * The import is avoided because that module does `require("nodemailer")` at
 * the top level, so importing it would drag in an SMTP library the app has no
 * use for (Venndra sends through Resend's HTTP API) and would fail outright
 * unless nodemailer were installed. NextAuth never constructs providers
 * itself -- core/lib/providers.js just merges whatever objects it's handed --
 * so a plain object with the right shape is a fully supported provider, not a
 * workaround.
 *
 * This exists mainly for people whose only calendar is Apple/iCloud. iCloud
 * connects over CalDAV with an app-specific password, which is a calendar
 * connection, not a NextAuth sign-in method -- so before this, an Apple-only
 * user had no way to have a Venndra account at all.
 *
 * Deliberately magic-link and not password. NextAuth v4 routes passwords
 * through the Credentials provider, which supports ONLY jwt sessions; Venndra
 * is database-session throughout (see authOptions.session.strategy), so adding
 * passwords would mean either running two session strategies at once or
 * reimplementing session handling around the adapter. A magic link needs
 * neither: it's a first-class database-session provider, and it also proves
 * the person controls the address, which is what makes the account linking in
 * lib/auth.ts safe.
 */

/** Magic links per address per minute. */
const SEND_LIMIT_PER_MINUTE = 3;

/** How long a link stays usable. */
const LINK_MAX_AGE_SECONDS = 10 * 60;

/**
 * The same window in whole minutes, exported so anything that TELLS a user how
 * long they have reads it from here rather than restating it. Both the emails
 * below and app/login/check-email have drifted from the real number before.
 */
export const LINK_MAX_AGE_MINUTES = Math.round(LINK_MAX_AGE_SECONDS / 60);

export function magicLinkProvider(): EmailConfig {
  return {
    id: "email",
    type: "email",
    name: "Email",
    // Required by NextAuth's EmailConfig type, and inert: `from` is read only
    // by the built-in nodemailer sendVerificationRequest, which the one below
    // replaces. The real From: is resolved inside sendEmail. Kept accurate
    // rather than stubbed so it can't contradict what actually goes out.
    from: fromAddress(),

    // 10 minutes, against NextAuth's 24-hour default. A magic link is a
    // bearer credential sitting in an inbox, and a full day is a long time
    // for one to stay live -- long enough to matter if the mailbox is on a
    // shared or already-compromised device. Short enough to be annoying only
    // if someone leaves the tab for ten minutes, and requesting another is
    // one click.
    //
    // This number carries more weight than it used to. Links are no longer
    // single use -- authAdapter.ts stopped consuming them, because the one use
    // was routinely being spent by a link scanner or an in-app webview instead
    // of by the person signing in -- so the window is now the only thing
    // bounding how long a link stays live. Lengthen it with that in mind.
    maxAge: LINK_MAX_AGE_SECONDS,

    // Required by NextAuth's EmailConfig type, and never read: `server` is
    // consumed only by the built-in nodemailer-based sendVerificationRequest,
    // which the one below replaces wholesale.
    server: "",

    sendVerificationRequest,
    options: {},
  };
}

async function sendVerificationRequest({ identifier, url }: SendVerificationRequestParams): Promise<void> {
  // Keyed on the address rather than a user id, because at this point there
  // may well not be a user -- an unknown address is a legitimate sign-up. That
  // makes this the one rate limit in the app an anonymous caller can trip, and
  // the thing it's protecting is somebody else's inbox: without it, anyone
  // could point the sign-in form at an address they don't own and use Venndra
  // to flood it.
  //
  // Throwing here aborts the send. NextAuth turns that into ?error=EmailSignin
  // on /login, which lib/authErrors.ts words as "too many requests, wait a
  // minute" -- the honest reading, since a genuine send failure and a rate
  // limit are indistinguishable to the user and both resolve by waiting.
  const allowed = await checkRateLimit("magic-link", identifier.toLowerCase(), SEND_LIMIT_PER_MINUTE);
  if (!allowed) {
    throw new Error(`Rate limit: too many magic links requested for ${identifier}`);
  }

  await sendEmail({
    to: identifier,
    subject: "Your Venndra sign-in link",
    text: text(url),
    html: html(url),
  });
}

function text(url: string): string {
  return [
    "Sign in to Venndra",
    "",
    `Open this link to sign in. It expires in ${LINK_MAX_AGE_MINUTES} minutes:`,
    url,
    "",
    "If you didn't ask to sign in, you can ignore this email — nobody can get into your account without this link.",
  ].join("\n");
}

// Inline styles and a table layout, because email clients are not browsers:
// Outlook in particular ignores most <style> blocks and has no flexbox. The
// palette matches the app's (ink #231F20, paper #F0EBE0, amber #E8963A).
function html(url: string): string {
  return `
<body style="margin:0;padding:0;background:#F0EBE0;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background:#F0EBE0;padding:32px 12px;">
    <tr>
      <td align="center">
        <table border="0" cellspacing="0" cellpadding="0" width="100%" style="max-width:520px;background:#ffffff;border:1px solid #D9D2C4;border-radius:16px;padding:32px;">
          <tr>
            <td style="font-family:Helvetica,Arial,sans-serif;font-size:24px;font-weight:600;color:#231F20;padding-bottom:8px;">
              Sign in to Venndra
            </td>
          </tr>
          <tr>
            <td style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:#231F20;opacity:0.7;padding-bottom:24px;">
              Click the button below to sign in. This link expires in ${LINK_MAX_AGE_MINUTES} minutes.
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <a href="${url}" target="_blank"
                 style="display:inline-block;background:#E8963A;color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:9999px;">
                Sign in
              </a>
            </td>
          </tr>
          <tr>
            <td style="font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:#231F20;opacity:0.5;border-top:1px solid #D9D2C4;padding-top:20px;">
              If the button doesn't work, paste this into your browser:<br />
              <span style="word-break:break-all;">${url}</span>
              <br /><br />
              If you didn't ask to sign in, you can ignore this email — nobody can get into your account without this link.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>`;
}
