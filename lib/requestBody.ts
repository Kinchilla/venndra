/**
 * Reads a request's JSON body without letting a malformed one become a 500
 * (#30).
 *
 * Every mutating route in this app starts the same way:
 *
 *     const parsed = schema.safeParse(await req.json());
 *     if (!parsed.success) return NextResponse.json({ error: ... }, { status: 400 });
 *
 * which reads like it handles a bad body, and does not. `req.json()` REJECTS
 * on a body that isn't valid JSON -- including an empty one -- and that throw
 * happens before safeParse is ever reached. An uncaught throw in a Next route
 * handler is a 500, so fourteen of the fifteen routes answered a malformed
 * body with a 500 and an empty response, in the very line written to answer it
 * with a 400. Measured, not assumed: POST /api/me/pause with `{oops` returned
 * 500, and with `{}` returned the intended 400.
 *
 * The fifteenth (app/api/feedback) wrote `.catch(() => null)` and behaved
 * correctly. One concept, two implementations, and the majority was the wrong
 * one -- which is the shape #30 exists to remove, rather than a bug in any one
 * route.
 *
 * It also mattered beyond the status code. instrumentation.ts exports
 * `onRequestError`, so every one of those 500s became a Sentry issue: anybody
 * with a session could turn a typo -- or a script -- into error-tracker noise
 * for something that is not an error at all, just a bad request.
 *
 * RETURNS null RATHER THAN THROWING, and null is not a special case any caller
 * has to handle. Every schema here is a z.object, and no object schema accepts
 * null, so the existing `if (!parsed.success)` line catches it and returns the
 * 400 it was always meant to. That is deliberate: the fix should not need a
 * new branch in fourteen routes, or it would be fourteen new places to get it
 * wrong.
 */
export async function jsonBody(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}
