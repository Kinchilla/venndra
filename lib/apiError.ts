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

/**
 * A non-OK response from a JSON endpoint. Carries the status, because 401 is
 * the one a caller acts on rather than displays: every page that loads data
 * this way already guards on a session, so a 401 means the session ended
 * underneath an open tab -- see SessionEndedNotice, and the note on the same
 * case in NewFriendForm.
 */
export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * GETs a JSON endpoint, rejecting rather than parsing when the response is not
 * OK.
 *
 * The read fetches on mount used to go `.then((r) => r.json())` with no status
 * check, which made every failure arrive as a JSON parse error: a 401 answers
 * `{ error: "Unauthorized" }` (which parses, then reads as an empty list), and
 * a 500 answers an HTML error page (which rejects, somewhere unrelated to the
 * real problem). Both reached the component as "no data" with nothing to say
 * about why. This asks the same two questions apiErrorMessage's callers ask --
 * was it OK, and what does it say -- once, for the read side.
 *
 * The mutating handlers deliberately keep spelling this out in place instead
 * of calling it: each of them acts on the status BEFORE asking for a message,
 * and in a different way (see the note on apiErrorMessage above).
 */
export async function fetchJson<T>(url: string, fallback?: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new ApiError(res.status, await apiErrorMessage(res, fallback ?? `GET ${url} failed with ${res.status}`));
  }
  return res.json();
}
