"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { WeeklyHours } from "./FiltersBuilder";

type Member = { email: string; name: string | null; image: string | null };

const DAY_LABELS: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export default function GroupChip({
  id,
  name,
  members,
  filters,
}: {
  id: string;
  name: string;
  members: Member[];
  filters: WeeklyHours;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
    setDeleting(true);
    setError(null);
    const res = await fetch(`/api/groups/${id}`, { method: "DELETE" });
    setDeleting(false);
    if (res.ok) {
      router.refresh();
    } else {
      setError("That didn't work — try again.");
    }
  }

  const memberNames = members.map((m) => m.name ?? m.email).join(", ");
  const dayLines: string[] = [];
  for (const day of DAY_ORDER) {
    for (const [start, end] of filters[day] ?? []) {
      dayLines.push(`${DAY_LABELS[day]}: ${start}–${end}`);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="font-medium">{name}</span>
        <span className="text-sm text-ink/50">{memberNames}</span>
      </button>

      <div className="accordion" data-open={expanded}>
        <div className="accordion-inner">
          <div className="border-t border-line/60 px-4 py-3 text-sm">
            <div className="sm:flex sm:items-start sm:gap-6">
              <div className="grid gap-2 sm:flex-1">
                {members.map((m) => (
                  <div key={m.email} className="flex items-center gap-2.5">
                    {m.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.image} alt="" referrerPolicy="no-referrer" className="h-6 w-6 rounded-full" />
                    ) : (
                      <span className="h-6 w-6 shrink-0 rounded-full bg-line" />
                    )}
                    <span className="text-ink/70">{m.name ?? m.email}</span>
                  </div>
                ))}
              </div>

              <div className="mt-3 sm:mt-0 sm:w-56 sm:shrink-0">
                <span className="text-ink/50">Default search windows: </span>
                {dayLines.length === 0 ? (
                  <span className="text-ink/70">Any day, any time</span>
                ) : (
                  <div className="mt-1 grid gap-0.5 text-ink/70">
                    {dayLines.map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={`/groups/${id}`}
                className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink/70 hover:border-teal hover:text-teal"
              >
                Edit this group
              </Link>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink/70 hover:border-red-600 hover:text-red-600 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete this group"}
              </button>
            </div>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
