// Browser runtime. Next loads this before any client component renders.
import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "./lib/sentryOptions";

Sentry.init(sentryOptions);

// Ties an error thrown during a client-side navigation back to the navigation
// that caused it, rather than to whatever page happened to be mounted.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
