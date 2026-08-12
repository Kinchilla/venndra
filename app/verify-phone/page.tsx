import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "../../lib/auth";
import { prisma } from "../../lib/prisma";
import { formatE164ForDisplay } from "../../lib/phone";
import { buttonClass } from "../../lib/buttonStyles";
import PhoneVerifyButton from "../../components/PhoneVerifyButton";

/**
 * Where the link in the verification text lands.
 *
 * Renders a confirmation to press rather than verifying on arrival -- see the
 * note in app/api/me/phone/verify for why a GET must not be what confirms a
 * number. This page is deliberately dull: it says which number, and it has one
 * button.
 */
export default async function VerifyPhonePage({ searchParams }: { searchParams?: { token?: string } }) {
  const token = searchParams?.token;

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    // Carrying the token through the sign-in round trip, so opening the text
    // on a phone that isn't signed in doesn't dead-end. The link is single-use
    // and time-limited either way.
    const target = `/verify-phone${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    redirect(`/login?callbackUrl=${encodeURIComponent(target)}`);
  }

  const user = await prisma.user.findUnique({
    where: { id: (session.user as any).id },
    select: { phone: true, phoneCountry: true, phoneVerifiedAt: true },
  });

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="font-display text-2xl font-semibold">Confirm your number</h1>

      {!token ? (
        <Shell message="This link is missing its code. Ask for a new text from Settings." />
      ) : user?.phoneVerifiedAt && user.phone ? (
        // Already done -- most likely the link was opened twice. Reads as
        // success rather than as an error, because for the user it is one.
        <Shell
          message={`${formatE164ForDisplay(user.phone, user.phoneCountry)} is verified. Friends can find you by it.`}
        />
      ) : !user?.phone ? (
        <Shell message="There's no number on your account to confirm. Add one in Settings." />
      ) : (
        <>
          <p className="mt-2 text-ink/60">
            Confirming tells Venndra that{" "}
            <span className="font-medium text-ink">{formatE164ForDisplay(user.phone, user.phoneCountry)}</span> is
            yours, so friends can find you by it.
          </p>
          <PhoneVerifyButton token={token} />
        </>
      )}
    </main>
  );
}

function Shell({ message }: { message: string }) {
  return (
    <>
      <p className="mt-2 text-ink/60">{message}</p>
      <Link href="/settings" className={buttonClass({ variant: "neutral", size: "lg", className: "mt-6 inline-block" })}>
        Go to Settings
      </Link>
    </>
  );
}
