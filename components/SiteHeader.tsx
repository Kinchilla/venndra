import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "../lib/auth";
import Logo from "./Logo";

export default async function SiteHeader() {
  const session = await getServerSession(authOptions);

  return (
    <header className="border-b border-line/60 bg-paper/80 backdrop-blur-sm">
      <div className="mx-auto grid max-w-5xl grid-cols-3 items-center px-6 py-3">
        <span aria-hidden="true" />

        <Link href="/" aria-label="Venndra — home" className="inline-flex items-baseline justify-self-center">
          <span className="font-display text-lg font-semibold">Ve</span>
          <Logo height={9.5} className="relative top-[0.5px]" />
          <span className="font-display text-lg font-semibold">dra</span>
        </Link>

        <div className="justify-self-end">
          {session?.user ? (
            <Link
              href="/settings"
              className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm hover:border-ink transition-colors"
            >
              {session.user.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={session.user.image} alt="" referrerPolicy="no-referrer" className="h-6 w-6 rounded-full" />
              ) : (
                <span className="h-6 w-6 rounded-full bg-line" />
              )}
              {session.user.name?.split(" ")[0] ?? "Profile"}
            </Link>
          ) : (
            <Link
              href="/login"
              className="rounded-full border border-line px-4 py-2 text-sm hover:border-ink transition-colors"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
