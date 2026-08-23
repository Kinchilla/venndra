"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * What to show when an action comes back 401 from a page that already guards on
 * a session -- so the session ended underneath an open tab, rather than the
 * user arriving signed out.
 *
 * The APIs answer that case with a bare "Unauthorized" (39 routes do), which is
 * meaningless to whoever reads it, and it used to be rendered verbatim. Unlike
 * every other failure on these forms this one has an obvious next step, so it
 * gets a link rather than a sentence.
 *
 * Lives here rather than in either caller because both say the same thing and
 * the wording would otherwise drift. callbackUrl is read from the current path
 * instead of taken as a prop, so a caller can't send someone back to a page
 * they weren't on.
 */
export default function SessionEndedNotice({ action, className }: { action: string; className?: string }) {
  const pathname = usePathname();

  return (
    <p className={className ?? "text-sm text-red-600"}>
      Your session ended.{" "}
      <Link href={`/login?callbackUrl=${encodeURIComponent(pathname)}`} className="underline">
        Sign in again
      </Link>{" "}
      to {action}.
    </p>
  );
}
