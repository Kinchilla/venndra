"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useClientValue } from "../hooks/useClientValue";
import { buttonClass } from "../lib/buttonStyles";

type ParticipantStatus = "free" | "tentative" | "busy" | "unknown" | "error";
type ParticipantAvailability = { email: string; name: string | null; status: ParticipantStatus };
type Slot = {
  start: string;
  end: string;
  availableCount: number;
  totalConnected: number;
  participants: ParticipantAvailability[];
};
type SortMode = "headcount" | "time" | "votes";
type TimeFormat = "12h" | "24h";
type TallyEntry = { voteCount: number; score: number; voters: { email: string; rank: number }[] };

const TIME_FORMAT_STORAGE_KEY = "venndra-time-format";

function formatTime(iso: string, format: TimeFormat): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: format === "12h" });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export default function EventResults({
  eventId,
  isCreator,
  status: initialStatus,
  confirmedStart,
  confirmedEnd,
  votingEnabled,
  writeCalendarProvider,
  organizerName,
  writeError,
}: {
  eventId: string;
  isCreator: boolean;
  status: string;
  confirmedStart: string | null;
  confirmedEnd: string | null;
  votingEnabled: boolean;
  writeCalendarProvider: string | null;
  organizerName: string;
  writeError: string | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [sortMode, setSortMode] = useState<SortMode>("headcount");
  const [timeFormat, setTimeFormat] = useState<TimeFormat>("12h");
  const [data, setData] = useState<{ slots: Slot[]; minAttendees: number | null; totalParticipants: number } | null>(null);
  const [tally, setTally] = useState<Map<string, TallyEntry>>(new Map());
  const [voteState, setVoteState] = useState<{ voteTopX: number; canVote: boolean; myVotes: string[] } | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedStart, setExpandedStart] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justConfirmed, setJustConfirmed] = useState<Slot | null>(null);
  const [actionLoading, setActionLoading] = useState<"cancel" | "reopen" | null>(null);

  // Hooks must run unconditionally, so this is computed here even though
  // it's only ever actually shown in the CONFIRMED/justConfirmed branch's
  // JSX further down -- can't call useClientValue from inside that
  // conditional return. Both toLocaleDateString's weekday/month names and
  // toLocaleTimeString's own formatting are locale-dependent, and Node's
  // server-side default locale can genuinely disagree with the browser's
  // own -- computing either during SSR and hydrating against a different
  // browser-computed string crashes with a hydration mismatch. Fallback
  // mirrors EventChip's date-range fallback: a plain MM/DD sliced straight
  // from the ISO string for the date, blank for the times (EventChip's own
  // fallback doesn't attempt an approximate time either), so there's still
  // a recognizable placeholder rather than fully blank text pre-mount.
  const confirmedStartIso = justConfirmed?.start ?? confirmedStart;
  const confirmedEndIso = justConfirmed?.end ?? confirmedEnd;
  const confirmedDisplay = useClientValue(
    () => ({
      date: confirmedStartIso
        ? new Date(confirmedStartIso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
        : "",
      startTime: confirmedStartIso ? formatTime(confirmedStartIso, timeFormat) : "",
      endTime: confirmedEndIso ? formatTime(confirmedEndIso, timeFormat) : "",
    }),
    { date: confirmedStartIso ? `${confirmedStartIso.slice(5, 7)}/${confirmedStartIso.slice(8, 10)}` : "", startTime: "", endTime: "" },
    [confirmedStartIso, confirmedEndIso, timeFormat]
  );

  // Once someone's explicitly picked 12h/24h, remember that choice across
  // visits. Until then, default to whatever their system already uses --
  // Intl's hourCycle is the standard way to read that, and it's the same
  // underlying signal the browser uses to decide how native date/time
  // inputs (like the ones on the event-creation page) display themselves,
  // so this keeps both pages consistent without the person having to
  // think about it.
  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(TIME_FORMAT_STORAGE_KEY) : null;
    if (saved === "12h" || saved === "24h") {
      setTimeFormat(saved);
      return;
    }
    const hourCycle = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle;
    setTimeFormat(hourCycle === "h23" || hourCycle === "h24" ? "24h" : "12h");
  }, []);

  function changeTimeFormat(next: TimeFormat) {
    setTimeFormat(next);
    window.localStorage.setItem(TIME_FORMAT_STORAGE_KEY, next);
  }

  useEffect(() => {
    if (status !== "SEARCHING") return;
    setLoading(true);
    fetch(`/api/events/${eventId}/availability`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [eventId, status]);

  function refreshVotes() {
    fetch(`/api/events/${eventId}/votes`)
      .then((r) => r.json())
      .then((d) => {
        const map = new Map<string, TallyEntry>();
        for (const t of d.tally ?? []) map.set(t.slotStart, { voteCount: t.voteCount, score: t.score, voters: t.voters ?? [] });
        setTally(map);
        setVoteState({
          voteTopX: d.voteTopX ?? 0,
          canVote: !!d.canVote,
          myVotes: (d.myVotes ?? [])
            .slice()
            .sort((a: any, b: any) => a.rank - b.rank)
            .map((v: any) => v.slotStart),
        });
      });
  }

  useEffect(() => {
    if (status !== "SEARCHING" || !votingEnabled) return;
    refreshVotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, status, votingEnabled]);

  // Adds/removes this slot from the signed-in person's ballot and saves
  // immediately -- there's no separate "review and save" step since voting
  // now happens one slot at a time, spread across each slot's own row,
  // rather than from one consolidated picker.
  async function handleToggleVote(slot: Slot) {
    if (!voteState) return;
    setVoteError(null);

    const alreadyVoted = voteState.myVotes.includes(slot.start);
    if (!alreadyVoted && voteState.myVotes.length >= voteState.voteTopX) return; // at the limit, ignore

    const nextVotes = alreadyVoted
      ? voteState.myVotes.filter((s) => s !== slot.start)
      : [...voteState.myVotes, slot.start];

    setVoteState({ ...voteState, myVotes: nextVotes }); // optimistic

    const res = await fetch(`/api/events/${eventId}/votes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ picks: nextVotes }),
    });

    if (!res.ok) {
      setVoteState(voteState); // revert
      const body = await res.json().catch(() => null);
      setVoteError(typeof body?.error === "string" ? body.error : "Couldn't save that vote.");
      return;
    }
    refreshVotes(); // tally changed too, not just my own picks
  }

  // All three sort modes are computed client-side now, rather than
  // re-fetching from the server per mode -- "most votes" needs both the
  // availability data AND the vote tally together, and the client already
  // has both, so there's no reason to make the server redo this.
  //
  //
  // Each mode's primary order:
  //  - "time": pure chronological.
  //  - "headcount": most-free first, ties broken by time only. Votes
  //    deliberately do NOT affect ordering here -- casting a vote used to
  //    make a slot jump position within its tier, which was disorienting.
  //    Votes only ever reorder anything in "votes" mode itself.
  //  - "votes": highest weighted score first (a rank-1 pick is worth more
  //    than a rank-3 pick, not just "was it picked at all"), ties broken
  //    by headcount, then time.
  const groups = useMemo(() => {
    const scoreOf = (slot: Slot) => tally.get(slot.start)?.score ?? 0;

    const sorted = [...(data?.slots ?? [])].sort((a, b) => {
      if (sortMode === "time") {
        return new Date(a.start).getTime() - new Date(b.start).getTime();
      }
      if (sortMode === "votes") {
        return (
          scoreOf(b) - scoreOf(a) ||
          b.availableCount - a.availableCount ||
          new Date(a.start).getTime() - new Date(b.start).getTime()
        );
      }
      // headcount
      return b.availableCount - a.availableCount || new Date(a.start).getTime() - new Date(b.start).getTime();
    });

    const map = new Map<string, Slot[]>();
    for (const slot of sorted) {
      const key =
        sortMode === "time"
          ? formatDate(slot.start)
          : sortMode === "votes"
            ? `${scoreOf(slot)} ${scoreOf(slot) === 1 ? "pt" : "pts"}`
            : `${slot.availableCount}/${data?.totalParticipants ?? 0} free`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(slot);
    }
    return map;
  }, [data, sortMode, tally]);

  function toggleExpanded(slotStart: string) {
    setError(null);
    setExpandedStart((prev) => (prev === slotStart ? null : slotStart));
  }

  async function handleConfirm(slot: Slot) {
    setConfirming(true);
    setError(null);
    const res = await fetch(`/api/events/${eventId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: slot.start }),
    });
    setConfirming(false);
    if (!res.ok) {
      const body = await res.json();
      setError(typeof body.error === "string" ? body.error : "Couldn't confirm that slot.");
      return;
    }
    setJustConfirmed(slot);
    setStatus("CONFIRMED");
  }

  async function handleCancel() {
    // Checks status directly rather than hedging with an "if it's already
    // confirmed" clause in the dialog text itself -- Venndra always knows
    // which state the event is in, so there's no reason to make the person
    // reading the dialog do that conditional reasoning themselves.
    let cancelConfirmText: string;
    if (status === "SEARCHING") {
      cancelConfirmText = "Cancel this search? This will delete it for everyone.";
    } else if (writeCalendarProvider === "APPLE_CALDAV") {
      // Apple write-back never sends real invites, so there's no
      // cancellation notice to send either -- it's only ever removed from
      // the organizer's own Apple calendar. Same reasoning as the "Locked
      // in" Apple note above.
      cancelConfirmText =
        "Cancel this event? It'll be removed from the organizer's Apple Calendar, but since iCloud doesn't support automatic invites, other attendees won't get a cancellation notice.";
    } else {
      cancelConfirmText = "Cancel this event? This will delete it for everyone -- everyone gets a cancellation notice on their calendar.";
    }
    if (!confirm(cancelConfirmText)) return;
    setActionLoading("cancel");
    const res = await fetch(`/api/events/${eventId}/cancel`, { method: "POST" });
    setActionLoading(null);
    if (res.ok) setStatus("CANCELLED");
  }

  async function handleReopen() {
    setActionLoading("reopen");
    const res = await fetch(`/api/events/${eventId}/reopen`, { method: "POST" });
    setActionLoading(null);
    if (res.ok) {
      setJustConfirmed(null);
      setExpandedStart(null);
      setStatus("SEARCHING");
      router.refresh();
    }
  }

  if (status === "CANCELLED") {
    return (
      <div className="rounded-2xl border border-line bg-white p-6">
        <p className="font-display text-xl font-semibold text-ink/60">This event was cancelled</p>
        <p className="mt-2 text-sm text-ink/50">
          {isCreator ? "You cancelled it" : "The organizer cancelled it"} — anyone who had it on their calendar was notified.
        </p>
      </div>
    );
  }

  if (status === "CONFIRMED" || justConfirmed) {
    return (
      <div className="rounded-2xl border border-teal bg-teal/5 p-6">
        <p className="font-display text-xl font-semibold text-teal">Locked in 🎉</p>
        <p className="mt-2 text-ink/70">
          {confirmedDisplay.date}, {confirmedDisplay.startTime}
          {" – "}
          {confirmedDisplay.endTime}
        </p>
        <p className="mt-1 text-sm text-ink/50">
          {writeCalendarProvider === "APPLE_CALDAV"
            ? `This was added to ${organizerName}'s Apple Calendar. Apple doesn't support automatic invites through Venndra yet — ${organizerName} will need to invite everyone manually.`
            : "A calendar invite is on its way to everyone."}
        </p>

        {writeError && isCreator && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{writeError}</p>}

        {isCreator && (
          <div className="mt-4 flex gap-3 border-t border-teal/20 pt-4">
            <button onClick={handleReopen} disabled={actionLoading !== null} className="text-sm text-teal hover:underline disabled:opacity-50">
              {actionLoading === "reopen" ? "Reopening…" : "Reschedule"}
            </button>
            <button onClick={handleCancel} disabled={actionLoading !== null} className="text-sm text-ink/40 hover:text-red-600 disabled:opacity-50">
              {actionLoading === "cancel" ? "Cancelling…" : "Cancel event"}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink/50">
          {data?.minAttendees ? `Showing slots with ${data.minAttendees}+ free` : "Every open slot found"}
        </p>
        <div className="flex flex-wrap items-center gap-3 text-xs text-ink/50">
          <div className="flex rounded-full border border-line p-0.5">
            <button
              onClick={() => setSortMode("headcount")}
              className={`rounded-full px-2.5 py-1 ${sortMode === "headcount" ? "bg-teal text-white" : ""}`}
            >
              who's free
            </button>
            {votingEnabled && (
              <button
                onClick={() => setSortMode("votes")}
                className={`rounded-full px-2.5 py-1 ${sortMode === "votes" ? "bg-teal text-white" : ""}`}
              >
                most votes
              </button>
            )}
            <button
              onClick={() => setSortMode("time")}
              className={`rounded-full px-2.5 py-1 ${sortMode === "time" ? "bg-teal text-white" : ""}`}
            >
              earliest
            </button>
          </div>
          <div className="flex rounded-full border border-line p-0.5">
            <button
              onClick={() => changeTimeFormat("12h")}
              className={`rounded-full px-2.5 py-1 ${timeFormat === "12h" ? "bg-teal text-white" : ""}`}
            >
              12h
            </button>
            <button
              onClick={() => changeTimeFormat("24h")}
              className={`rounded-full px-2.5 py-1 ${timeFormat === "24h" ? "bg-teal text-white" : ""}`}
            >
              24h
            </button>
          </div>
        </div>
      </div>

      {loading && <p className="text-sm text-ink/50">Checking everyone's calendars…</p>}

      {!loading && groups.size === 0 && (
        <p className="text-sm text-ink/50">No slots match yet — try widening the search window or filters.</p>
      )}

      <div className="grid gap-6">
        {[...groups.entries()].map(([label, slots]) => (
          <SlotGroup
            key={label}
            groupLabel={label}
            slots={slots}
            totalParticipants={data?.totalParticipants ?? 0}
            timeFormat={timeFormat}
            showDateOnTile={sortMode !== "time"}
            tally={tally}
            votingEnabled={votingEnabled}
            voteState={voteState}
            voteError={voteError}
            onToggleVote={handleToggleVote}
            expandedStart={expandedStart}
            onToggle={toggleExpanded}
            isCreator={isCreator}
            confirming={confirming}
            error={error}
            onConfirm={handleConfirm}
          />
        ))}
      </div>

      {isCreator && (
        <button onClick={handleCancel} disabled={actionLoading !== null} className="mt-6 text-sm text-ink/40 hover:text-red-600 disabled:opacity-50">
          {actionLoading === "cancel" ? "Cancelling…" : "Cancel this search"}
        </button>
      )}
    </div>
  );
}

const VISIBLE_SLOTS_PER_GROUP = 4;

/**
 * One group of slot rows -- a calendar day ("earliest" mode), a headcount
 * tier ("who's free" mode), or a vote-count tier ("most votes" mode) --
 * showing only the first few by default with a "show N more" toggle for
 * the rest.
 */
function SlotGroup({
  groupLabel,
  slots,
  totalParticipants,
  timeFormat,
  showDateOnTile,
  tally,
  votingEnabled,
  voteState,
  voteError,
  onToggleVote,
  expandedStart,
  onToggle,
  isCreator,
  confirming,
  error,
  onConfirm,
}: {
  groupLabel: string;
  slots: Slot[];
  totalParticipants: number;
  timeFormat: TimeFormat;
  showDateOnTile: boolean;
  tally: Map<string, TallyEntry>;
  votingEnabled: boolean;
  voteState: { voteTopX: number; canVote: boolean; myVotes: string[] } | null;
  voteError: string | null;
  onToggleVote: (slot: Slot) => void;
  expandedStart: string | null;
  onToggle: (start: string) => void;
  isCreator: boolean;
  confirming: boolean;
  error: string | null;
  onConfirm: (slot: Slot) => void;
}) {
  const [expandedList, setExpandedList] = useState(false);
  const visible = expandedList ? slots : slots.slice(0, VISIBLE_SLOTS_PER_GROUP);
  const hiddenCount = slots.length - visible.length;

  return (
    <div>
      <p className="mb-2 font-mono-tight text-xs uppercase tracking-widest text-ink/50">{groupLabel}</p>
      <div className="grid gap-1.5">
        {visible.map((slot) => (
          <SlotRow
            key={slot.start}
            slot={slot}
            totalParticipants={totalParticipants}
            timeFormat={timeFormat}
            showDate={showDateOnTile}
            votes={tally.get(slot.start) ?? null}
            votingEnabled={votingEnabled}
            voteState={voteState}
            voteError={expandedStart === slot.start ? voteError : null}
            onToggleVote={() => onToggleVote(slot)}
            isOpen={expandedStart === slot.start}
            onToggle={() => onToggle(slot.start)}
            isCreator={isCreator}
            confirming={confirming}
            error={expandedStart === slot.start ? error : null}
            onConfirm={() => onConfirm(slot)}
          />
        ))}
      </div>
      {/*
        Both expand/collapse controls share one centred row. The wrapper is
        rendered only when one of them exists, so an empty flex container can't
        contribute its top margin and nudge the layout when neither applies.
      */}
      {(hiddenCount > 0 || (expandedList && slots.length > VISIBLE_SLOTS_PER_GROUP)) && (
        <div className="mt-1.5 flex justify-center">
          {hiddenCount > 0 && (
            <button
              onClick={() => setExpandedList(true)}
              className={buttonClass({ variant: "quiet", size: "nav", className: "inline-flex items-center gap-1.5" })}
            >
              +{hiddenCount} more
              <Caret />
            </button>
          )}
          {expandedList && slots.length > VISIBLE_SLOTS_PER_GROUP && (
            <button
              onClick={() => setExpandedList(false)}
              className={buttonClass({ variant: "quiet", size: "nav", className: "inline-flex items-center gap-1.5" })}
            >
              Show fewer
              <Caret up />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The disclosure caret, shared by the slot chips and the expand/collapse
 * controls under each group so every "there's more below" affordance in this
 * view is literally the same mark. Points down by default and flips up when
 * `up` is set; inherits colour from its parent, so it picks up the button's
 * hover state for free.
 */
function Caret({ up = false, className = "" }: { up?: boolean; className?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      className={`transition-transform ${up ? "rotate-180" : ""} ${className}`}
      aria-hidden="true"
    >
      <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Red -> green gradient by fraction available, using muted tones that fit the rest of the palette. */
function gradientColors(ratio: number): { border: string; bg: string } {
  const clamped = Math.max(0, Math.min(1, ratio));
  const from = { r: 196, g: 87, b: 63 }; // muted brick red
  const to = { r: 63, g: 143, b: 92 }; // muted forest green
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * clamped);
  const r = lerp(from.r, to.r);
  const g = lerp(from.g, to.g);
  const b = lerp(from.b, to.b);
  return { border: `rgb(${r} ${g} ${b})`, bg: `rgba(${r}, ${g}, ${b}, 0.12)` };
}

/** A single slot: a gradient-tinted row that expands in place to show every participant's status. */
function SlotRow({
  slot,
  totalParticipants,
  timeFormat,
  showDate,
  votes,
  votingEnabled,
  voteState,
  voteError,
  onToggleVote,
  isOpen,
  onToggle,
  isCreator,
  confirming,
  error,
  onConfirm,
}: {
  slot: Slot;
  totalParticipants: number;
  timeFormat: TimeFormat;
  showDate: boolean;
  votes: TallyEntry | null;
  votingEnabled: boolean;
  voteState: { voteTopX: number; canVote: boolean; myVotes: string[] } | null;
  voteError: string | null;
  onToggleVote: () => void;
  isOpen: boolean;
  onToggle: () => void;
  isCreator: boolean;
  confirming: boolean;
  error: string | null;
  onConfirm: () => void;
}) {
  const ratio = totalParticipants > 0 ? slot.availableCount / totalParticipants : 0;
  const { border, bg } = gradientColors(ratio);

  const myRankIndex = voteState?.myVotes.indexOf(slot.start) ?? -1;
  const isVoted = myRankIndex !== -1;
  const atVoteLimit = !!voteState && !isVoted && voteState.myVotes.length >= voteState.voteTopX;

  return (
    <div className="overflow-hidden rounded-xl border" style={{ borderColor: border }}>
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-sm transition-colors"
        style={{ backgroundColor: bg }}
      >
        <span className="flex items-center gap-2">
          <span className="font-medium">
            {showDate && <>{formatDate(slot.start)}, </>}
            {formatTime(slot.start, timeFormat)} – {formatTime(slot.end, timeFormat)}
          </span>
        </span>
        <span className="flex items-center gap-2">
          {votes && (
            <span
              className="text-xs font-medium text-amber"
              title={`${votes.voteCount} ${votes.voteCount === 1 ? "person" : "people"} voted for this`}
            >
              🗳️ {votes.score} {votes.score === 1 ? "pt" : "pts"}
            </span>
          )}
          <span className="text-xs font-medium" style={{ color: border }}>
            {slot.availableCount}/{totalParticipants} free
          </span>
          <Caret up={isOpen} className="text-ink/40" />
        </span>
      </button>

      <div className="accordion" data-open={isOpen}>
        <div className="accordion-inner">
          <div className="border-t border-line/60 bg-white p-3.5">
            <ul className="grid gap-1.5">
              {slot.participants.map((p) => {
                const theirVote = votes?.voters.find((v) => v.email === p.email);
                return (
                  <li key={p.email} className="flex items-center gap-2 text-sm">
                    <StatusIcon status={p.status} />
                    <span className={p.status === "unknown" ? "text-ink/40" : "text-ink/80"}>
                      {p.name ? `${p.name} (${p.email})` : p.email}
                    </span>
                    {theirVote && (
                      <span
                        className="rounded-full bg-amber/15 px-1.5 py-0.5 text-[10px] font-bold text-amber"
                        title={`Ranked this their #${theirVote.rank} choice`}
                      >
                        🗳️ #{theirVote.rank}
                      </span>
                    )}
                    {p.status === "unknown" && <span className="text-xs text-ink/30">(hasn't connected a calendar)</span>}
                    {p.status === "error" && <span className="text-xs text-orange-500/70">(couldn't check their calendar)</span>}
                  </li>
                );
              })}
            </ul>

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            {voteError && <p className="mt-3 text-sm text-red-600">{voteError}</p>}

            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              {votingEnabled && voteState?.canVote && (
                <button
                  onClick={onToggleVote}
                  disabled={atVoteLimit}
                  title={atVoteLimit ? `You've used all ${voteState.voteTopX} of your votes` : undefined}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    isVoted ? "border-teal bg-teal text-white" : "border-line text-ink/70 hover:border-teal"
                  }`}
                >
                  {isVoted ? `✓ Voted (#${myRankIndex + 1})` : "Vote"}
                </button>
              )}
              {isCreator ? (
                <button
                  onClick={onConfirm}
                  disabled={confirming}
                  className={buttonClass({ variant: "primary" })}
                >
                  {confirming ? "Locking in…" : "Choose this time"}
                </button>
              ) : (
                !votingEnabled && <p className="text-sm text-ink/50">Only the organizer can lock in a time.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Small colored status badge, mirroring Google Calendar's own RSVP iconography. */
function StatusIcon({ status }: { status: ParticipantStatus }) {
  const common = "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white";
  if (status === "free") {
    return (
      <span className={`${common} bg-[#3F8F5C]`} title="Free" aria-label="Free">
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2 6.5L4.5 9L10 3" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (status === "busy") {
    return (
      <span className={`${common} bg-[#C4573F]`} title="Not free" aria-label="Not free">
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2.5 2.5L9.5 9.5M9.5 2.5L2.5 9.5" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  if (status === "tentative") {
    return (
      <span className={`${common} bg-amber`} title="Tentative" aria-label="Tentative">
        <span className="text-[10px] font-bold leading-none">?</span>
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className={`${common} bg-orange-500`} title="Couldn't check their calendar right now" aria-label="Error">
        <span className="text-[10px] font-bold leading-none">!</span>
      </span>
    );
  }
  return (
    <span className={`${common} bg-ink/20`} title="Hasn't connected a calendar" aria-label="Unknown">
      <span className="text-[10px] font-bold leading-none">–</span>
    </span>
  );
}
