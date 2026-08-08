"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useClientValue } from "../hooks/useClientValue";
import { buttonClass } from "../lib/buttonStyles";

type Participant = {
  email: string;
  userId: string | null;
  status: "INVITED" | "CONNECTED";
  name: string | null;
};
type Candidate = {
  userId: string | null;
  name: string | null;
  email: string;
  eligible: boolean;
  reason: "not-joined" | "no-write-target" | null;
  provider: string | null;
};
type EventChipData = {
  id: string;
  title: string;
  organizerName: string;
  isOrganizer: boolean;
  creatorId: string;
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
  writeCalendarProvider: string | null;
  writeError: string | null;
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

export default function EventChip({ event }: { event: EventChipData }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [actionLoading, setActionLoading] = useState<"cancel" | "reopen" | "leave" | "loadCandidates" | "reassign" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  // Separate from actionError -- lives and dies with the picker itself
  // (rendered inside ReassignPicker, reset whenever the picker opens or
  // closes) rather than in the chip's general error slot, which would
  // otherwise keep a failed-transfer message visible even after collapsing
  // the picker that caused it.
  const [pickerError, setPickerError] = useState<string | null>(null);
  // Which candidate's "Make organizer" button is mid-request -- lets the
  // picker grey out only that one row rather than every row, even though
  // every button in the picker is functionally inert while this is set.
  const [reassigningUserId, setReassigningUserId] = useState<string | null>(null);

  // Knowable instantly from the already-widened participants prop -- no
  // need to hit reassign-candidates just to find out the event is solo.
  const hasOtherParticipants = event.participants.some((p) => p.userId !== event.creatorId);

  async function handleCancel() {
    // Checks event.status directly rather than hedging with an "if it's
    // already confirmed" clause in the dialog text itself -- Venndra always
    // knows which state the event is in, so there's no reason to make the
    // person reading the dialog do that conditional reasoning themselves.
    const transferSuggestion = hasOtherParticipants
      ? " If you want to leave it yourself while keeping it intact for everyone else, you can transfer the organizer role and then leave it."
      : "";
    let cancelConfirmText: string;
    if (event.status === "SEARCHING") {
      cancelConfirmText = `Cancel this search? This will delete it for everyone.${transferSuggestion}`;
    } else if (event.writeCalendarProvider === "APPLE_CALDAV") {
      // Apple write-back never sends real invites, so there's no
      // cancellation notice to send either -- it's only ever removed from
      // the organizer's own Apple calendar. Same reasoning as the
      // leave-confirmation text below.
      cancelConfirmText = `Cancel this event? It'll be removed from the organizer's Apple Calendar, but since iCloud doesn't support automatic invites, other attendees won't get a cancellation notice.${transferSuggestion}`;
    } else {
      cancelConfirmText = `Cancel this event? This will delete it for everyone -- everyone gets a cancellation notice on their calendar.${transferSuggestion}`;
    }
    if (!confirm(cancelConfirmText)) return;
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

  async function handleLeave() {
  // Apple write-back never sends a real invite -- the organizer has to add
  // people manually if they want to (see the manual-invite note elsewhere
  // on this chip). So unlike Google/Microsoft, Venndra has no way to know
  // or control whether this ever ended up on the leaving person's own
  // calendar, and can't remove it either way -- the usual "will disappear
  // from your personal calendar" claim would be misleading here.
  const leaveConfirmText =
    event.status === "CONFIRMED" && event.writeCalendarProvider === "APPLE_CALDAV"
      ? "Leave this event? You'll be removed from the attendee list here in Venndra. If you added this event to your personal calendar, you may wish to delete that as well, since iCloud doesn't support automatic invite updates."
      : "Leave this event? You'll be removed from the attendee list, and this will disappear from your Venndra events and personal calendar.";
  if (!confirm(leaveConfirmText)) return;
  setActionLoading("leave");
  setActionError(null);
  const res = await fetch(`/api/events/${event.id}/leave`, { method: "POST" });
  setActionLoading(null);
  if (res.ok) {
    router.refresh();
  } else {
    const body = await res.json().catch(() => null);
    setActionError(typeof body?.error === "string" ? body.error : "Couldn't leave this event.");
  }
}

  // Doesn't touch pickerError itself -- callers decide what to show
  // alongside the refreshed list (a load failure vs. a stale-row refresh
  // after a failed transfer shouldn't stomp on each other's messaging).
  async function fetchCandidates(): Promise<boolean> {
    setActionLoading("loadCandidates");
    const res = await fetch(`/api/events/${event.id}/reassign-candidates`);
    setActionLoading(null);
    if (res.ok) {
      const body = await res.json();
      setCandidates(body.candidates ?? []);
      return true;
    }
    return false;
  }

  async function handleOpenPicker() {
    if (pickerOpen) {
      setPickerOpen(false);
      setCandidates(null);
      setPickerError(null);
      return;
    }
    setPickerOpen(true);
    setPickerError(null);
    const ok = await fetchCandidates();
    if (!ok) setPickerError("Couldn't load who's on this event.");
  }

  async function handleReassign(candidate: Candidate) {
    if (!candidate.userId) return;
    setActionLoading("reassign");
    setReassigningUserId(candidate.userId);
    setPickerError(null);
    const res = await fetch(`/api/events/${event.id}/reassign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newOrganizerUserId: candidate.userId }),
    });
    if (res.ok) {
      setActionLoading(null);
      router.refresh();
      return;
    }
    const body = await res.json().catch(() => null);
    setPickerError(typeof body?.error === "string" ? body.error : "Couldn't transfer the organizer role.");
    // Eligibility may have changed since the list was fetched (e.g. they
    // disconnected their write-target calendar in another tab) -- refresh
    // rather than leaving a stale eligible-looking row in place.
    await fetchCandidates();
    setReassigningUserId(null);
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

  const headerText = useClientValue(
    () =>
      event.status === "CONFIRMED" && event.confirmedStart && event.confirmedEnd
        ? formatConfirmed(event.confirmedStart, event.confirmedEnd)
        : formatDateRange(event.searchStart, event.searchEnd),
    `${event.searchStart.slice(5, 7)}/${event.searchStart.slice(8, 10)} – ${event.searchEnd.slice(5, 7)}/${event.searchEnd.slice(8, 10)}`
  );

  const searchWindowText = useClientValue(
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
            {event.status === "CONFIRMED" && event.writeCalendarProvider === "APPLE_CALDAV" && (
              <p className="mt-2 rounded-lg bg-amber/10 px-3 py-2 text-xs text-ink/60">
                {event.isOrganizer
                  ? "You'll need to invite everyone to this manually — iCloud doesn't support automatic calendar invites through Venndra."
                  : `${event.organizerName} needs to invite everyone to this manually — iCloud doesn't support automatic calendar invites through Venndra.`}
              </p>
            )}
            {event.writeError && event.isOrganizer && (
              <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{event.writeError}</p>
            )}
            {event.isOrganizer && (event.status === "CANCELLED" || (event.status === "CONFIRMED" && event.isPast)) && (
              <button
                onClick={handleDelete}
                disabled={actionLoading !== null}
                className={buttonClass({ variant: "danger", className: "mt-3" })}
              >
                {actionLoading === "cancel" ? "Deleting…" : "Delete"}
              </button>
            )}

            {event.status === "SEARCHING" && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={`/events/${event.id}`} className={buttonClass({ variant: "primary", className: "inline-block" })}>
                  Pick a time
                </Link>
                {event.isOrganizer && (
                  <button
                    onClick={handleEdit}
                    disabled={actionLoading !== null}
                    className={buttonClass({ variant: "edit" })}
                  >
                    Edit this search
                  </button>
                )}
                {event.isOrganizer && hasOtherParticipants && (
                  <button
                    onClick={handleOpenPicker}
                    disabled={actionLoading !== null}
                    className={buttonClass({ variant: "edit" })}
                  >
                    {actionLoading === "loadCandidates" ? "Loading…" : "Transfer organizer role"}
                  </button>
                )}
                {event.isOrganizer && (
                  <button
                    onClick={handleCancel}
                    disabled={actionLoading !== null}
                    className={buttonClass({ variant: "danger" })}
                  >
                    {actionLoading === "cancel" ? "Cancelling…" : "Cancel this search"}
                  </button>
                )}
                {!event.isOrganizer && (
                  <button
                    onClick={handleLeave}
                    disabled={actionLoading !== null}
                    className={buttonClass({ variant: "danger" })}
                  >
                    {actionLoading === "leave" ? "Leaving…" : "Leave this event"}
                  </button>
                )}
              </div>
            )}

            {event.isOrganizer && pickerOpen && event.status === "SEARCHING" && (
              <ReassignPicker
                candidates={candidates}
                confirmed={false}
                actionLoading={actionLoading}
                reassigningUserId={reassigningUserId}
                pickerError={pickerError}
                onPick={handleReassign}
                onClose={handleOpenPicker}
              />
            )}

            {event.isOrganizer && event.status === "CONFIRMED" && !event.isPast && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={handleReschedule}
                  disabled={actionLoading !== null}
                  className={buttonClass({ variant: "edit" })}
                >
                  {actionLoading === "reopen" ? "Reopening…" : "Reschedule"}
                </button>
                {hasOtherParticipants && (
                  <button
                    onClick={handleOpenPicker}
                    disabled={actionLoading !== null}
                    className={buttonClass({ variant: "edit" })}
                  >
                    {actionLoading === "loadCandidates" ? "Loading…" : "Transfer organizer role"}
                  </button>
                )}
                <button
                  onClick={handleCancel}
                  disabled={actionLoading !== null}
                  className={buttonClass({ variant: "danger" })}
                >
                  {actionLoading === "cancel" ? "Cancelling…" : "Cancel event"}
                </button>
              </div>
            )}
            {event.isOrganizer && pickerOpen && event.status === "CONFIRMED" && !event.isPast && (
              <ReassignPicker
                candidates={candidates}
                confirmed={true}
                actionLoading={actionLoading}
                reassigningUserId={reassigningUserId}
                pickerError={pickerError}
                onPick={handleReassign}
                onClose={handleOpenPicker}
              />
            )}
            {!event.isOrganizer && event.status === "CONFIRMED" && !event.isPast && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={handleLeave}
                  disabled={actionLoading !== null}
                  className={buttonClass({ variant: "danger" })}
                >
                  {actionLoading === "leave" ? "Leaving…" : "Leave this event"}
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

const INELIGIBLE_REASON_TEXT: Record<NonNullable<Candidate["reason"]>, string> = {
  "not-joined": "Hasn't joined Venndra yet.",
  "no-write-target": "No calendar set to receive new events.",
};

function ReassignPicker({
  candidates,
  confirmed,
  actionLoading,
  reassigningUserId,
  pickerError,
  onPick,
  onClose,
}: {
  candidates: Candidate[] | null;
  confirmed: boolean;
  actionLoading: string | null;
  reassigningUserId: string | null;
  pickerError: string | null;
  onPick: (candidate: Candidate) => void;
  onClose: () => void;
}) {
  return (
    <div className="mt-3 rounded-lg border border-line/60 p-3">
      {candidates === null ? (
        <p className="text-sm text-ink/50">Loading…</p>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-ink/50">No one else is on this event.</p>
      ) : (
        <div className="grid gap-2.5">
          {candidates.map((c) => {
            const label = c.name ?? c.email;
            return (
              <div key={c.userId ?? c.email} className={`flex items-center justify-between gap-3 ${c.eligible ? "" : "opacity-50"}`}>
                <div>
                  <div className={`text-sm ${c.eligible ? "text-ink/80" : "text-ink/60"}`}>{label}</div>
                  {c.eligible ? (
                    <p className="mt-0.5 text-xs text-ink/50">
                      {label} will become the organizer. You&apos;ll stay on as a participant -- leave separately afterward if you&apos;d like to.
                      {c.provider === "APPLE_CALDAV"
                        ? confirmed
                          ? ` Since iCloud doesn't support automatic invites, ${label} will need to invite everyone manually.`
                          : ` Since iCloud doesn't support automatic invites, ${label} will need to invite everyone manually once a time is confirmed.`
                        : ""}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs text-ink/40">{INELIGIBLE_REASON_TEXT[c.reason ?? "not-joined"]}</p>
                  )}
                </div>
                {c.eligible && (
                  <button
                    onClick={() => onPick(c)}
                    disabled={actionLoading !== null}
                    // Only the row actually being handed off visually greys
                    // out -- the rest stay functionally disabled (the
                    // `disabled` attribute still blocks the click) but keep
                    // their normal appearance, rather than every row dimming
                    // for a single click elsewhere in the list.
                    className={`shrink-0 rounded-full bg-amber px-3 py-1.5 text-xs font-medium text-white ${
                      reassigningUserId === c.userId ? "opacity-50" : ""
                    }`}
                  >
                    {reassigningUserId === c.userId ? "Transferring…" : "Make organizer"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {pickerError && <p className="mt-2 text-sm text-red-600">{pickerError}</p>}
      <button
        onClick={onClose}
        disabled={actionLoading !== null}
        className="mt-3 text-xs font-medium text-ink/50 hover:text-ink/70 disabled:opacity-50"
      >
        Never mind
      </button>
    </div>
  );
}