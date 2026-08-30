import * as Sentry from "@sentry/nextjs";

/**
 * One place for the Sentry.init options, shared by the three runtimes Next
 * gives us -- Node (sentry.server.config.ts), Edge (sentry.edge.config.ts)
 * and the browser (instrumentation-client.ts). Sharing the options is safe;
 * what is not safe is calling Sentry.init more than once inside a single
 * runtime, which is what causes the "Maximum call stack size exceeded" crash
 * people hit on Next 16 + Turbopack (getsentry/sentry-javascript#19367 --
 * closed as unreproducible once the reporter found their own second init).
 * So: options here, exactly one init per config file, and no init anywhere
 * else.
 *
 * The DSN is deliberately the NEXT_PUBLIC_ one on the server too. A DSN is
 * not a secret -- it is an ingest endpoint, it ships inside the browser
 * bundle by design, and it grants nothing but the ability to send events in.
 * Using one variable for all three runtimes removes the failure mode where
 * it's set in two of them and quietly missing from the third.
 *
 * With no DSN set, Sentry.init is a no-op: nothing is sent, nothing throws.
 * That is what lets this ship before the Sentry project exists, and it is
 * also why local dev stays silent unless you deliberately opt in.
 */

/** Keys whose values never leave this machine, at any depth of an event. */
const SECRET_KEY = /token|secret|password|passwd|authorization|cookie|session|api[-_]?key|credential|encryption/i;

/**
 * Access tokens that appear inside a string rather than under a key of their
 * own -- an `Authorization: Bearer ...` header echoed back inside a Google API
 * error message, most likely. `ya29.` is the Google access-token prefix.
 */
const SECRET_IN_STRING = /\b(Bearer\s+[\w.\-~+/]+=*|ya29\.[\w.\-~+/]+)/gi;

/**
 * OAuth-sensitive query parameters, wherever they show up inside a URL --
 * next-auth logs the full request URL on an OAUTH_CALLBACK_ERROR, and that
 * URL is where Google's authorization `code` lives. Found in production,
 * 2026-08-29: an OAUTH_CALLBACK_ERROR event carried a live `code=` value in
 * the clear, past both SECRET_IN_STRING above (it matches neither `Bearer`
 * nor `ya29.` -- that prefix is for access tokens, not authorization codes)
 * and Sentry's own default scrubber (which caught `authuser` on the same URL
 * but has no rule for `code`).
 *
 * `state` is deliberately NOT in this list: it's a CSRF nonce, not a
 * credential on its own, and it's usually the exact thing worth seeing when
 * this class of error ("state cookie was missing") is what you're debugging.
 * The param name stays, only the value goes -- same shape as Bearer above.
 */
const OAUTH_PARAM_IN_STRING = /([?&](?:code|access_token|refresh_token|id_token|client_secret|session_state)=)[^&\s"']+/gi;

const REDACTED = "[redacted]";

/**
 * Walks an event and removes anything that looks like a credential. This app
 * holds live OAuth access and refresh tokens, an encrypted iCloud app
 * password, and other people's email addresses, so the question isn't whether
 * the code we wrote logs a secret -- it doesn't -- but whether a third-party
 * error object carries one along with it. googleapis and Prisma both attach
 * request context to their errors, and that context is where a token would
 * ride out.
 *
 * Depth-bounded and cycle-safe, because this runs on the unhappy path of an
 * app that is already failing, and a scrubber that throws would turn a
 * reported error into an unreported one.
 */
function scrub<T>(value: T, seen: WeakSet<object>, depth = 0): T {
  if (depth > 8) return REDACTED as T;
  if (typeof value === "string") {
    return value.replace(SECRET_IN_STRING, REDACTED).replace(OAUTH_PARAM_IN_STRING, `$1${REDACTED}`) as T;
  }
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return REDACTED as T;
  seen.add(value);

  if (Array.isArray(value)) return value.map((v) => scrub(v, seen, depth + 1)) as T;

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = SECRET_KEY.test(key) ? REDACTED : scrub(v, seen, depth + 1);
  }
  return out as T;
}

/**
 * Node's own internal warning printer (DeprecationWarning, ExperimentalWarning,
 * MaxListenersExceededWarning, ...) writes through console.error, so
 * captureConsoleIntegration below -- installed to catch OUR OWN console.error
 * sites -- catches Node's internal ones too as a side effect. Confirmed in
 * production, 2026-08-29: `(node:4) [DEP0169] DeprecationWarning: url.parse()
 * ...` arrived as an Issue despite touching none of this app's code -- a
 * dependency (next-auth v4 is the likely source) triggers it internally.
 * There is nothing here to act on in response to one; drop them before they
 * spend the free tier's event quota or bury a real alert under noise.
 */
const NODE_PROCESS_WARNING = /^\(node:\d+\)\s*(?:\[[\w-]+\]\s*)?\w*Warning:/;

function isNodeProcessWarning(event: { message?: string; exception?: { values?: { value?: string }[] } }): boolean {
  const text = event.message ?? event.exception?.values?.[0]?.value ?? "";
  return NODE_PROCESS_WARNING.test(text);
}

/** Applied to every outbound event, whatever the runtime. */
function scrubEvent<T extends object>(event: T): T | null {
  if (isNodeProcessWarning(event as { message?: string })) return null;
  try {
    return scrub(event, new WeakSet());
  } catch {
    // A scrubber that throws would drop the error it was meant to protect.
    // Losing the event entirely is the safe direction to fail in: better a
    // missing report than an unscrubbed one.
    return null;
  }
}

export const sentryOptions = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Vercel sets this to "production" | "preview" | "development", which is
  // exactly the split we want in the Sentry UI: a preview deploy throwing
  // should not page anyone or pollute production's error rate.
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,

  // Off. The 15 console.error sites this was installed for (issue #38) are
  // errors, not spans, and the free tier's quota is better spent on all of
  // them than on a sample of page loads. Turn this up if performance ever
  // becomes the question being asked.
  tracesSampleRate: 0,

  // The point of the whole exercise: the existing console.error calls become
  // Sentry issues without a single call site being edited. Restricted to
  // "error" on purpose -- the only two console.log sites in the app are the
  // dev-only email and SMS dumps (lib/email.ts, lib/sms.ts), which print a
  // recipient address and a phone number. Neither can run in production, but
  // "captures errors only" is a much easier property to keep true than
  // "captures everything, and nothing that runs is ever sensitive".
  integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],

  // Explicit rather than relying on the default. True would attach cookies,
  // headers and IP addresses -- and our cookie is a live session token.
  sendDefaultPii: false,

  beforeSend: scrubEvent,
  beforeSendTransaction: scrubEvent,
};
