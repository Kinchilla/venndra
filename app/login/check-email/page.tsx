import Link from "next/link";
import { buttonClass } from "../../../lib/buttonStyles";

/**
 * Where NextAuth parks the browser once a magic link has been sent
 * (authOptions.pages.verifyRequest). Replaces NextAuth's unbranded built-in
 * version of this page.
 *
 * Deliberately does NOT name the address the link went to, and is identical
 * whether or not an account exists for it. NextAuth reaches this page in both
 * cases -- an unknown address is a legitimate sign-up, not an error -- and
 * saying anything specific would turn the sign-in form into a way to test
 * whether a given person has a Venndra account.
 */
export default function CheckEmailPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="font-display text-3xl font-semibold">Check your email</h1>
      <p className="mt-3 text-ink/70">
        If that address is one we can reach, a sign-in link is on its way. Open it on this device and you&apos;ll be
        signed straight in.
      </p>
      <p className="mt-4 text-sm text-ink/50">
        The link works once and expires in 15 minutes. If it doesn&apos;t arrive within a minute or two, check your spam
        folder before requesting another.
      </p>
      <Link href="/login" className={buttonClass({ variant: "neutral", size: "xl", className: "mt-8 text-center" })}>
        Back to sign in
      </Link>
    </main>
  );
}
