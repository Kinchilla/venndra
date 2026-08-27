import * as Sentry from "@sentry/nextjs";

/**
 * Next calls this once per server runtime, before any other application code
 * -- which is the only place an error tracker can be installed from and still
 * catch the errors thrown while the app is starting up.
 *
 * The two branches are not interchangeable and must not be collapsed into a
 * single import: the Node and Edge builds of the SDK are different bundles,
 * and importing the Node one into an Edge function fails at build time.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

/**
 * Server-side render and route-handler errors that Next catches itself, and
 * would otherwise only show up in the runtime log that issue #38 exists
 * because of. Without this export they never reach Sentry at all.
 */
export const onRequestError = Sentry.captureRequestError;
