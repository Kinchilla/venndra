/**
 * Human wording for NextAuth's `?error=` codes.
 *
 * authOptions.pages.error points at /login, so EVERY OAuth failure lands there
 * with a code in the query string -- including failures from "connect another
 * account", which isn't a sign-in at all. The two situations need different
 * words for the same code, hence two functions rather than one map: mid-connect
 * the user is signed in and nothing about their session changed, while on a
 * genuine sign-in attempt they're signed out and stuck.
 *
 * Codes come from next-auth/core/errors + the callback route; the ones handled
 * explicitly are those actually reachable from these two flows. Anything else
 * falls through to a generic message that still shows the raw code, so an
 * unexpected failure is diagnosable instead of anonymous.
 */

/** Shown on /settings, when an already-signed-in user was connecting an extra account. */
export function connectErrorMessage(code: string): string {
  switch (code) {
    case "OAuthAccountNotLinked":
      // Says who can undo this, because nothing the CURRENT user does will.
      // The block is a claim recorded in Venndra, not a browser session -- an
      // earlier version told people to sign out of the account in their
      // browser, which changes nothing at all.
      return "That account is already claimed by a different Venndra account. To move it here, whoever holds it has to disconnect it from their own settings first.";
    case "AccessDenied":
      return "That account didn't grant Venndra the access it needs. If it's a work or school account, an administrator may have to approve Venndra before you can connect it.";
    case "OAuthCallback":
    case "OAuthSignin":
      return `Couldn't finish connecting that account — the provider turned the request away. For a work or school account this usually means it isn't permitted to use this app yet. (${code})`;
    // Distinct from OAuthCallback, and worth keeping distinct: "Callback" means
    // the provider handshake SUCCEEDED and Venndra's own callback handler threw
    // afterwards -- typically the adapter failing to save the account. Blaming
    // the provider here sends people to check settings that are already fine.
    case "Callback":
      return `That account signed in successfully, but Venndra couldn't finish saving the connection. This is a problem on Venndra's side, not with your account. (${code})`;
    case "Configuration":
      return `Venndra's connection to that provider isn't configured correctly, so the request couldn't be completed. (${code})`;
    // Not a "connect another account" failure at all -- it lands here because
    // /login bounces every error code to Settings once you're signed in, and
    // these two are the magic-link codes. Reachable by clicking a stale
    // sign-in link from your inbox while already signed in, where the useful
    // thing to say is that nothing is wrong.
    case "Verification":
    case "EmailSignin":
      return "That sign-in link has expired or was already used — but you're already signed in, so there's nothing to do.";
    default:
      return `Couldn't connect that account. (${code})`;
  }
}

/** Shown on /login, for a genuine signed-out sign-in attempt. */
export function signInErrorMessage(code: string): string {
  switch (code) {
    case "OAuthAccountNotLinked":
      // Thrown by callback-handler when an account already exists under this
      // provider's email address and the provider isn't set to auto-link.
      // The email route out is offered first because it always works and
      // needs nothing set up: a magic link to that same address reaches the
      // existing account directly (NextAuth's email branch matches on email
      // regardless of how the account was created), and this provider can
      // then be attached for good from Settings.
      return "An account already exists for that email address. Sign in with the email link below and you'll land in it — you can then connect this Google or Microsoft account from Settings, and sign in with it directly from then on.";
    case "AccessDenied":
      return "You didn't grant Venndra the access it needs to sign you in. If this is a work or school account, an administrator may have to approve Venndra first.";
    // The email provider's send step failed. Covers a genuinely broken send
    // and a tripped rate limit alike -- lib/magicLink.ts throws for both and
    // NextAuth collapses them into this one code. Waiting is the right advice
    // either way, and distinguishing them would tell an anonymous caller
    // whether they'd hit a limit.
    case "EmailSignin":
      return "Couldn't send that sign-in link just now. If you've asked for a few in a row, wait a minute and try again.";
    // The token in a clicked link was missing, already used, or past its
    // 15-minute expiry.
    case "Verification":
      return "That sign-in link has expired or was already used. Request a fresh one below.";
    default:
      return `Couldn't sign you in. Try again, or use a different account. (${code})`;
  }
}
