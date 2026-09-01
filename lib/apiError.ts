/**
 * Turns a failed fetch Response into a sentence to show the user (#30).
 *
 * Every mutating handler in this app ends the same way, and before this each
 * of them wrote it out again:
 *
 *     const body = await res.json().catch(() => null);
 *     setError(typeof body?.error === "string" ? body.error : "Couldn't ...");
 *
 * Thirteen copies, in three slightly different spellings, and both differences
 * were load-bearing:
 *
 * The `.catch` is not defensive noise. An unhandled 500 comes back as an HTML
 * error page, and res.json() REJECTS on it -- so a handler without the catch
 * dies at that line with no message set and its button re-enabled, which looks
 * to the user exactly like pressing the button did nothing. That was a real
 * bug, fixed one component at a time (see the note it left in NewFriendForm);
 * anything written without it would have been the same bug again.
 *
 * The `typeof === "string"` is not defensive noise either. Routes answer a
 * failed zod parse with `{ error: parsed.error.flatten() }`, which is an
 * OBJECT. One call site used `body.error ?? fallback` instead
 * (ConnectedAccountsSection) and would have put that object straight into a
 * string state and rendered it. Its own endpoint happens not to validate a
 * body, so it never fired -- a bug that existed only because two call sites
 * disagreed about the same question.
 *
 * Deliberately does NOT read res.status. Some callers act on a status before
 * asking for a message (NewFriendForm treats 401 as "the session ended
 * underneath this tab" and never shows a server sentence), and that decision
 * belongs to them.
 */
export async function apiErrorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return typeof body?.error === "string" ? body.error : fallback;
}
