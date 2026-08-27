// Edge runtime (middleware and any route with `runtime = "edge"`). Loaded
// once, by instrumentation.ts's register(). Nothing in the app runs on Edge
// today, but Next loads this hook if that ever changes, and an empty one
// would be a silent blind spot rather than an obvious missing file.
import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "./lib/sentryOptions";

Sentry.init(sentryOptions);
