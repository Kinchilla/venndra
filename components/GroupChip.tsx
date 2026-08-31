"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { WeeklyHours } from "../lib/searchWindow";
import { usePendingAction } from "../hooks/usePendingAction";
import { buttonClass } from "../lib/buttonStyles";
import Avatar from "./Avatar";
import { displayName } from "../lib/displayName";

// `email` stays on the type because it's this list's identity key -- a saved
// group is stored as a bare array of addresses (SavedGroup.emails, no foreign
// key), so it's the only thing that can key the rows or match them back to a
// user. It is no longer rendered: see displayName below.
type Member = { email: string; userId: string | null; name: string | null; image: string | null };

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
  // A successful delete takes this chip with it, so the button stays inactive
  // until the refreshed list commits -- see hooks/usePendingAction.
  const { pending, busy, begin, release, commit } = usePendingAction<"delete">();
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
    begin("delete");
    setError(null);
    const res = await fetch(`/api/groups/${id}`, { method: "DELETE" });
    if (res.ok) {
      commit(() => router.refresh());
    } else {
      release();
      setError("That didn't work — try again.");
    }
  }

  const memberNames = members.map(displayName).join(", ");
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
        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
        <span className="min-w-0 max-w-[45%] shrink-0 truncate text-sm text-ink/50">{memberNames}</span>
      </button>

      <div className="accordion" data-open={expanded}>
        <div className="accordion-inner">
          <div className="border-t border-line/60 px-4 py-3 text-sm">
            <div className="sm:flex sm:items-start sm:gap-6">
              <div className="grid grid-cols-1 gap-2 sm:flex-1">
                {members.map((m) => (
                  <div key={m.email} className="flex items-center gap-2.5">
                    <Avatar image={m.image} name={displayName(m)} colorKey={m.userId} size={24} />
                    <span className="text-ink/70">{displayName(m)}</span>
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
                className={buttonClass({ variant: "edit" })}
              >
                Edit this group
              </Link>
              <button
                onClick={handleDelete}
                disabled={busy}
                className={buttonClass({ variant: "danger" })}
              >
                {pending === "delete" ? "Deleting…" : "Delete this group"}
              </button>
            </div>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
