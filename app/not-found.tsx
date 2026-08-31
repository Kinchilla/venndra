import Link from "next/link";
import { buttonClass } from "../lib/buttonStyles";

/**
 * The 404 (issue #40). Next renders this for any route that doesn't match --
 * a stale link, a typo, a page that used to exist -- and for an explicit
 * notFound() call from a page that looked up something by id and came up
 * empty.
 *
 * Rendered inside the root layout, same as any other page, so the header and
 * its nav are still there: a dead end shouldn't also strand you without a way
 * back in.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col items-center px-6 py-24 text-center">
      <p className="font-mono-tight text-xs uppercase tracking-widest text-teal">404</p>
      <h1 className="mt-3 font-display text-4xl font-semibold">Page not found</h1>
      <p className="mt-4 max-w-md text-ink/70">
        That link's stale, or the page moved. There's nothing here to see.
      </p>
      <Link href="/" className={buttonClass({ variant: "primary", size: "lg", className: "mt-8 inline-block" })}>
        Back home
      </Link>
    </main>
  );
}
