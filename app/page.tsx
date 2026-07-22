import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "../lib/auth";

export default async function Home() {
  const session = await getServerSession(authOptions);

  return (
    <main className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
      <section className="grid gap-12 sm:grid-cols-2 sm:items-center">
        <div>
          <p className="mb-3 font-mono-tight text-xs uppercase tracking-widest text-teal">
            the scheduling app for friend groups
          </p>
          <h1 className="font-display text-5xl font-semibold leading-[1.05] sm:text-6xl">
            Stop asking
            <br />
            "when's everyone free?"
          </h1>
          <p className="mt-6 max-w-md text-lg text-ink/70">
            Making plans with friends should be fun, not frustrating. No more endlessly texting
            back and forth in the group chat trying to find a time that works for everyone: Venndra
            compares calendars and tells you which time slots work for which people.
          </p>
          <Link
            href={session?.user ? "/events/new" : "/login?callbackUrl=/events/new"}
            className="mt-8 inline-block rounded-full bg-amber px-6 py-3 font-medium text-white shadow-sm hover:brightness-105 transition"
          >
            + New event
          </Link>
          <Link
            href={session?.user ? "/events" : "/login?callbackUrl=/events"}
            className="mt-8 ml-3 inline-block rounded-full border border-line px-6 py-3 font-medium text-ink/70 hover:border-ink transition"
          >
            Existing events
          </Link>
        </div>
        <OverlapDiagram />
      </section>
    </main>
  );
}

/**
 * Signature visual: three friends' weeks stacked as horizontal bands, with
 * their busy blocks shown as solid marks and the one moment all three are
 * free glowing in amber. This is the one idea the whole product is about,
 * so it's the one thing on the page that gets to be illustrative.
 */
function OverlapDiagram() {
  const rows = [
    { name: "You", busy: [[10, 40], [65, 85]] },
    { name: "Sam", busy: [[0, 25], [80, 100]] },
    { name: "Rae", busy: [[20, 50], [70, 100]] },
  ];
  const freeStart = 50;
  const freeEnd = 65;

  return (
    <div className="rounded-2xl border border-line bg-white/60 p-6">
      <svg viewBox="0 0 300 140" className="w-full" role="img" aria-label="Three friends' calendars with one shared free slot highlighted">
        {rows.map((row, i) => {
          const y = 20 + i * 36;
          return (
            <g key={row.name}>
              <text x="0" y={y + 5} className="font-mono-tight" fontSize="9" fill="#231F20" opacity="0.6">
                {row.name}
              </text>
              <rect x="40" y={y - 8} width="255" height="16" rx="8" fill="#F0EBE0" />
              {row.busy.map(([s, e], j) => (
                <rect
                  key={j}
                  x={40 + (s / 100) * 255}
                  y={y - 8}
                  width={((e - s) / 100) * 255}
                  height="16"
                  rx="8"
                  fill="#D9D2C4"
                />
              ))}
            </g>
          );
        })}
        {/* the shared open moment, glowing across all three rows */}
        <rect
          x={40 + (freeStart / 100) * 255}
          y="0"
          width={((freeEnd - freeStart) / 100) * 255}
          height="112"
          rx="6"
          fill="#E8963A"
          opacity="0.18"
        />
        <rect
          x={40 + (freeStart / 100) * 255}
          y="0"
          width={((freeEnd - freeStart) / 100) * 255}
          height="112"
          rx="6"
          fill="none"
          stroke="#E8963A"
          strokeWidth="1.5"
          strokeDasharray="3 2"
        />
      </svg>
      <p className="mt-3 text-center font-mono-tight text-xs text-amber">
        everyone's free here!
      </p>
    </div>
  );
}
