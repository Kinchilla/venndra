/**
 * Transactional SMS, via Twilio.
 *
 * The mirror of lib/email.ts, and deliberately so -- same single choke point,
 * same lazy configuration, same development fallback -- because "what does
 * Venndra send people" should have two files to read, not two files and a
 * scattering of direct API calls.
 *
 * No `twilio` package. The Messages endpoint is one form-encoded POST behind
 * HTTP basic auth, which is less code than configuring the SDK, and the SDK
 * pulls a sizeable dependency tree into a serverless bundle to do the same
 * request. If sending ever needs more of Twilio's surface than this, that's
 * the point to reconsider.
 *
 * Configuration is read at call time rather than module load, for the reason
 * lib/email.ts gives: this module is reachable from routes that never send
 * anything, and a missing credential should not be a crash on every request.
 */

type TwilioConfig = { accountSid: string; authToken: string; from: string };

/**
 * `from` accepts either a Twilio phone number in E.164 or a Messaging Service
 * SID (the `MG...` form). Twilio's API takes them in different fields, which
 * is the only reason this distinction is visible below -- to a caller it's
 * just "where the message comes from."
 */
function getConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!accountSid || !authToken || !from) return null;
  return { accountSid, authToken, from };
}

/**
 * True when the app is actually able to text someone.
 *
 * Exported so the phone field can be hidden rather than shown broken: in
 * production with no Twilio credentials, offering to verify a number would
 * take the number, promise a text, and never send one, leaving the field stuck
 * on "pending" with no way forward. Better to not offer it at all until the
 * account exists.
 */
export function smsConfigured(): boolean {
  return getConfig() !== null || process.env.NODE_ENV !== "production";
}

export type SendSmsParams = {
  /** E.164. */
  to: string;
  body: string;
};

/**
 * Sends one text, or throws.
 *
 * Throws for the same reason sendEmail does: every caller's next act is to
 * tell the user something is on its way, and a swallowed failure turns that
 * into a person waiting for a message that was never sent.
 *
 * With no Twilio credentials, behaviour splits by environment exactly as email
 * does -- logged to the terminal in development so the verification link can
 * be clicked locally without a Twilio account or a registered sending number,
 * and a loud failure in production.
 */
export async function sendSms({ to, body }: SendSmsParams): Promise<void> {
  const config = getConfig();

  if (!config) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Twilio is not configured, so no text could be sent.");
    }
    // eslint-disable-next-line no-console
    console.log(`\n--- sms (dev, not actually sent) ---\nTo: ${to}\n\n${body}\n---\n`);
    return;
  }

  const params = new URLSearchParams({ To: to, Body: body });
  // A Messaging Service is passed as MessagingServiceSid; a bare number as
  // From. Sending the wrong field is a 400 from Twilio, not a silent no-op.
  if (config.from.startsWith("MG")) params.set("MessagingServiceSid", config.from);
  else params.set("From", config.from);

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      // Basic auth, account SID as the username. Built here rather than with a
      // helper because Buffer is the only Node-specific thing this file needs.
      Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  // Twilio reports auth failures, unregistered sending numbers, and
  // unreachable destinations as HTTP errors with a JSON body -- fetch resolves
  // for all of them, so without this check a refused send looks like a sent one.
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Twilio refused the message (${res.status}): ${detail.slice(0, 300)}`);
  }
}
