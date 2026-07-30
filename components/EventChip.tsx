"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Participant = { email: string };
type EventChipData = {
  id: string;
  title: string;
  organizerName: string;
  isOrganizer: boolean;
  isPast: boolean;
  status: string;
  participants: Participant[];
  durationMin: number;
  searchStart: string; // ISO string, not a Date -- see note above
  searchEnd: string;
  filters: Record<string, [string, string][]>;
  minAttendees: number | null;
  confirmedStart: string | null;
  confirmedEnd: string | null;
};

const DAY_LABELS: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function formatDateRange(startIso: string, endIso: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${new Date(startIso).toLocaleDateString(undefined, opts)} – ${new Date(endIso).toLocaleDateString(undefined, opts)}`;
}

function formatConfirmed(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const date = start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const startTime = start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const endTime = new Date(endIso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} · ${startTime} – ${endTime}`;
}

// Collapses days sharing the same window back into groups, e.g. "Mon, Tue,
// Wed: 18:00–22:00" -- mirrors how FiltersBuilder builds these in the first place.
function formatFilters(filters: Record<string, [string, string][]>): string {
  const byWindow = new Map<string, string[]>();
  for (const day of DAY_ORDER) {
    for (const [start, end] of filters[day] ?? []) {
      const key = `${start}-${end}`;
      if (!byWindow.has(key)) byWindow.set(key, []);
      byWindow.get(key)!.push(DAY_LABELS[day]);
    }
  }
  if (byWindow.size === 0) return "Any day, any time";
  return [...byWindow.entries()].map(([key, days]) => `${days.join(", ")}: ${key.replace("-", "–")}`).join(" · ");
}

// Renders `fallback` on the very first pass (both server and the client's
// initial hydration render use this same fixed string, so nothing can
// mismatch), then swaps to the real, locale-formatted result right after
// mounting in the browser. Deliberately client-only rather than reading
// the Accept-Language header server-side -- Brave (and possibly other
// privacy-focused browsers) intentionally randomizes that header as a
// fingerprinting defense, independent of what the browser's own real
// Intl calls actually use, so the two can genuinely disagree.
function useClientFormatted(compute: () => string, fallback: string): string {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    setValue(compute());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}

export default function EventChip({ event }: { event: EventChipData }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [actionLoading, setActionLoading] = useState<"cancel" | "reopen" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleCancel() {
    if (!confirm("Cancel this event? If it's already confirmed, everyone gets a cancellation notice on their calendar.")) return;
    setActionLoading("cancel");
    setActionError(null);
    const res = await fetch(`/api/events/${event.id}/cancel`, { method: "POST" });
    setActionLoading(null);
    if (res.ok) {
      router.refresh();
    } else {
      const body = await res.json().catch(() => null);
      setActionError(typeof body?.error === "string" ? body.error : "Couldn't cancel this event.");
    }
  }

  function handleEdit() {
    // Deliberately doesn't cancel the original here -- that only happens
    // once the replacement search is actually submitted successfully
    // (see app/events/new/page.tsx), so there's always exactly one live
    // version of this search, never a gap where neither exists.
    router.push(`/events/new?fromEvent=${event.id}`);
  }

  async function handleReschedule() {
    setActionLoading("reopen");
    setActionError(null);
    const res = await fetch(`/api/events/${event.id}/reopen`, { method: "POST" });
    setActionLoading(null);
    if (res.ok) {
      router.refresh();
    } else {
      const body = await res.json().catch(() => null);
      setActionError(typeof body?.error === "string" ? body.error : "Couldn't reschedule this event.");
    }
  }

  async function handleDelete() {
    if (!confirm("This will permanently delete this event from your Venndra profile, which cannot be undone. It will not affect your linked calendars. Are you sure you want to delete?")) return;
    setActionLoading("cancel"); // reusing the same loading state -- only one action button shows at a time in this case anyway
    setActionError(null);
    const res = await fetch(`/api/events/${event.id}`, { method: "DELETE" });
    setActionLoading(null);
    if (res.ok) {
      router.refresh();
    } else {
      const body = await res.json().catch(() => null);
      setActionError(typeof body?.error === "string" ? body.error : "Couldn't delete this event.");
    }
  }

  const headerText = useClientFormatted(
    () =>
      event.status === "CONFIRMED" && event.confirmedStart && event.confirmedEnd
        ? formatConfirmed(event.confirmedStart, event.confirmedEnd)
        : formatDateRange(event.searchStart, event.searchEnd),
    `${event.searchStart.slice(5, 7)}/${event.searchStart.slice(8, 10)} – ${event.searchEnd.slice(5, 7)}/${event.searchEnd.slice(8, 10)}`
  );

  const searchWindowText = useClientFormatted(
    () => formatDateRange(event.searchStart, event.searchEnd),
    `${event.searchStart.slice(5, 7)}/${event.searchStart.slice(8, 10)} – ${event.searchEnd.slice(5, 7)}/${event.searchEnd.slice(8, 10)}`
  );
  
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="font-medium">{event.title}</span>
        <span className="text-sm text-teal">{headerText}</span>
      </button>

      <div className="accordion" data-open={expanded}>
        <div className="accordion-inner">
          <div className="border-t border-line/60 px-4 py-3 text-sm">
            <p className="text-ink/70">
              <span className="text-ink/50">Organizer: </span>
              {event.organizerName}
            </p>
            <p className="mt-1.5 text-ink/70">
              <span className="text-ink/50">Invited: </span>
              {event.participants.map((p) => p.email).join(", ")}
            </p>
            <p className="mt-1.5 text-ink/70">
              <span className="text-ink/50">Length: </span>
              {event.durationMin >= 60 ? `${event.durationMin / 60} hr` : `${event.durationMin} min`}
            </p>
            <p className="mt-1.5 text-ink/70">
              <span className="text-ink/50">Search window: </span>
              {searchWindowText}
            </p>
            <p className="mt-1.5 text-ink/70">
              <span className="text-ink/50">Times: </span>
              {formatFilters(event.filters)}
            </p>
            {event.minAttendees && (
              <p className="mt-1.5 text-ink/70">
                <span className="text-ink/50">Minimum: </span>
                {event.minAttendees}+ people free
              </p>
            )}
            {event.isOrganizer && (event.status === "CANCELLED" || (event.status === "CONFIRMED" && event.isPast)) && (
              <button
                onClick={handleDelete}
                disabled={actionLoading !== null}
                className="mt-3 rounded-full border border-line px-4 py-2 text-sm font-medium text-ink/70 hover:border-red-600 hover:text-red-600 disabled:opacity-50"
              >
                {actionLoading === "cancel" ? "Deleting…" : "Delete"}
              </button>
            )}

            {event.status === "SEARCHING" && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={`/events/${event.id}`} className="inline-block rounded-full bg-amber px-4 py-2 text-sm font-medium text-white">
                  Pick a time
                </Link>
                {event.isOrganizer && (
                  <button
                    onClick={handleEdit}
                    disabled={actionLoading !== null}
                    className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink/70 hover:border-teal hover:text-teal disabled:opacity-50"
                  >
                    Edit this search
                  </button>
                )}
                {event.isOrganizer && (
                  <button
                    onClick={handleCancel}
                    disabled={actionLoading !== null}
                    className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink/70 hover:border-red-600 hover:text-red-600 disabled:opacity-50"
                  >
                    {actionLoading === "cancel" ? "Cancelling…" : "Cancel this search"}
                  </button>
                )}
              </div>
            )}

            {event.isOrganizer && event.status === "CONFIRMED" && !event.isPast && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={handleReschedule}
                  disabled={actionLoading !== null}
                  className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink/70 hover:border-teal hover:text-teal disabled:opacity-50"
                >
                  {actionLoading === "reopen" ? "Reopening…" : "Reschedule"}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={actionLoading !== null}
                  className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink/70 hover:border-red-600 hover:text-red-600 disabled:opacity-50"
                >
                  {actionLoading === "cancel" ? "Cancelling…" : "Cancel event"}
                </button>
              </div>
            )}
            {actionError && <p className="mt-2 text-sm text-red-600">{actionError}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}