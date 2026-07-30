"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { addMonths } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { useSearchParams } from "next/navigation";
import FriendPicker from "../../../components/FriendPicker";
import FiltersBuilder, { WeeklyHours } from "../../../components/FiltersBuilder";
import BackButton from "../../../components/BackButton";

type SavedGroup = { id: string; name: string; emails: string[]; defaultFilters: WeeklyHours | null };

/** YYYY-MM-DD in the browser's own local timezone -- deliberately not
 *  toISOString(), which converts to UTC first and can silently shift the
 *  calendar date near midnight depending on the person's timezone offset. */
function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Converts a stored UTC instant back into the correct YYYY-MM-DD in the
// event's OWN timezone -- not necessarily the current browser's, since
// naively slicing the ISO string can land on the wrong calendar day near
// timezone boundaries (exactly the bug localDateString itself exists to
// avoid, just now needing to reverse a stored value instead of "now").
function isoToLocalDateString(iso: string, timezone: string): string {
  return localDateString(toZonedTime(new Date(iso), timezone));
}

/** Backs a number input with its own raw TEXT state instead of binding
 *  directly to a number -- letting the field stay genuinely empty while
 *  focused, rather than snapping to "0" the instant it's cleared (since
 *  Number("") === 0, a plain number-bound input can never actually be
 *  empty, which is what caused the old "erase then type 2, get 02" bug).
 *  `numericValue` is what the rest of the component should actually use;
 *  `floor` is only applied once the field is blurred while still empty. */
function useNumberField(initial: number, floor: number) {
  const [text, setText] = useState(String(initial));
  const parsed = Number(text);
  const numericValue = text.trim() === "" || Number.isNaN(parsed) ? floor : parsed;

  return {
    text,
    numericValue,
    setValue: (n: number) => setText(String(n)),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value),
    onBlur: () => {
      if (text.trim() === "") setText(String(floor));
    },
  };
}

export default function NewEventPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const [groups, setGroups] = useState<SavedGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const durationHoursField = useNumberField(2, 0);
  const durationMinutesField = useNumberField(0, 0);
  const durationMin = durationHoursField.numericValue * 60 + durationMinutesField.numericValue;
  const [startDate, setStartDate] = useState(() => localDateString(new Date()));
  const [endDate, setEndDate] = useState(() => localDateString(addMonths(new Date(), 1)));
  const [emails, setEmails] = useState<string[]>([]);
  const [filters, setFilters] = useState<WeeklyHours>({});
  const [useThreshold, setUseThreshold] = useState(true);
  const minAttendeesField = useNumberField(1, 1);
  const [votingEnabled, setVotingEnabled] = useState(false);
  const voteTopXField = useNumberField(3, 1);

  const [submitting, setSubmitting] = useState(false);
  const [pickerHasPendingText, setPickerHasPendingText] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/groups")
      .then((r) => r.json())
      .then((d) => setGroups(d.groups ?? []));
  }, []);

  // Default to including yourself -- the common case -- while still
  // letting it be removed like any other chip. Only fires once, so
  // removing yourself (or picking a saved group that doesn't include you)
  // afterward doesn't get silently undone.
  const [selfPrefilled, setSelfPrefilled] = useState(false);
  useEffect(() => {
    if (session?.user?.email && !selfPrefilled) {
      setEmails((prev) => (prev.includes(session.user!.email!) ? prev : [session.user!.email!, ...prev]));
      setSelfPrefilled(true);
    }
  }, [session, selfPrefilled]);

  // "Edit this search" (triggered from a Still Deciding chip on /events)
  // lands here with ?fromEvent=<id> -- pull that event's full parameters
  // and populate the form with them. Marks selfPrefilled true regardless
  // of outcome, so the plain self-prefill effect above never fights with
  // this one over the emails list.
  const [prefilledFromEvent, setPrefilledFromEvent] = useState(false);
  useEffect(() => {
    const fromEventId = searchParams.get("fromEvent");
    if (!fromEventId || prefilledFromEvent) return;
    setPrefilledFromEvent(true);
    setSelfPrefilled(true);

    fetch(`/api/events/${fromEventId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const event = data?.event;
        if (!event) return; // invalid id, or not involved in it -- fail quietly, leave the form at its normal defaults

        setTitle(event.title);
        setDescription(event.description ?? "");
        setLocation(event.location ?? "");
        durationHoursField.setValue(Math.floor(event.durationMin / 60));
        durationMinutesField.setValue(event.durationMin % 60);
        setStartDate(isoToLocalDateString(event.searchStart, event.timezone));
        setEndDate(isoToLocalDateString(event.searchEnd, event.timezone));
        setFilters(event.filters ?? {});
        setUseThreshold(event.minAttendees != null);
        if (event.minAttendees != null) minAttendeesField.setValue(event.minAttendees);
        setVotingEnabled(event.votingEnabled);
        if (event.voteTopX != null) voteTopXField.setValue(event.voteTopX);
        setEmails(event.participants.map((p: any) => p.email));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, prefilledFromEvent]);

  const [cachedCurrentUser, setCachedCurrentUser] = useState<{ email: string; name: string | null; image: string | null } | null>(null);
  useEffect(() => {
    if (session?.user?.email) {
      setCachedCurrentUser({ email: session.user.email, name: session.user.name ?? null, image: session.user.image ?? null });
    }
  }, [session]);

  function applyGroup(groupId: string) {
    setSelectedGroupId(groupId);
    const group = groups.find((g) => g.id === groupId);
    if (group) {
      setEmails(group.emails);
      if (group.defaultFilters) setFilters(group.defaultFilters);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pickerHasPendingText) {
      setError('Finish adding or clear the text in "People to include" before starting the search.');
      return;
    }
    if (emails.length === 0) {
      setError("Add at least one friend's email.");
      return;
    }
    if (durationMin < 5 || durationMin > 1440) {
      setError("Length needs to be somewhere between 5 minutes and 24 hours.");
      return;
    }
    if (endDate < startDate) {
      setError("End date can't be before the start date.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description: description || undefined,
        location: location || undefined,
        durationMin,
        searchStart: startDate,
        searchEnd: endDate,
        timezone: (session?.user as any)?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        filters,
        minAttendees: useThreshold ? minAttendeesField.numericValue : undefined,
        votingEnabled,
        voteTopX: votingEnabled ? voteTopXField.numericValue : undefined,
        emails,
      }),
    });

    setSubmitting(false);
    if (!res.ok) {
      setError("Couldn't create that search — check the fields above.");
      return;
    }
    const { event } = await res.json();

    // If this form was opened via "Edit this search," only cancel the
    // original NOW that its replacement genuinely exists -- not fired-
    // and-forgotten to block navigation on, since the new event already
    // exists regardless of whether this cleanup step succeeds.
    const fromEventId = searchParams.get("fromEvent");
    if (fromEventId) {
      fetch(`/api/events/${fromEventId}/cancel`, { method: "POST" }).catch(() => {});
    }

    router.push(`/events/${event.id}`);
  }

  return (
    <main className="mx-auto max-w-lg px-6 py-12">
      <BackButton fallbackHref="/events" />
      <h1 className="font-display text-2xl font-semibold">Find us a time</h1>

      <form onSubmit={handleSubmit} className="mt-6 grid gap-5">
        <label className="text-sm">
          <span className="mb-1 block text-ink/60">Event name</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Game Night" required className="w-full rounded-lg border border-line px-3 py-2" />
        </label>

        <div className="text-sm">
          <span className="mb-1 block text-ink/60">Length</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={24}
              step={1}
              value={durationHoursField.text}
              onChange={durationHoursField.onChange}
              onBlur={durationHoursField.onBlur}
              className="w-16 rounded-lg border border-line px-2 py-2 text-center"
            />
            <span className="text-ink/60">hours</span>
            <input
              type="number"
              min={0}
              max={59}
              step={5}
              value={durationMinutesField.text}
              onChange={durationMinutesField.onChange}
              onBlur={durationMinutesField.onBlur}
              className="w-16 rounded-lg border border-line px-2 py-2 text-center"
            />
            <span className="text-ink/60">minutes</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <label className="text-sm">
            <span className="mb-1 block text-ink/60">Search from</span>
            <input
              type="date"
              value={startDate}
              min={localDateString(new Date())}
              onChange={(e) => setStartDate(e.target.value)}
              required
              className="w-full rounded-lg border border-line px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink/60">Search until</span>
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
              className="w-full rounded-lg border border-line px-3 py-2"
            />
          </label>
        </div>

        <label className="text-sm">
          <span className="mb-1 block text-ink/60">Location (optional)</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} className="w-full rounded-lg border border-line px-3 py-2" />
        </label>

        <div>
          <p className="mb-2 text-sm text-ink/60">Start from a saved group</p>
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <button
                type="button"
                key={g.id}
                onClick={() => applyGroup(g.id)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  selectedGroupId === g.id ? "border-amber bg-amber/10 text-amber" : "border-line text-ink/60 hover:border-amber hover:text-amber"
                }`}
              >
                {g.name}
              </button>
            ))}
            <Link
              href="/groups/new"
              className="rounded-full border border-dashed border-line px-3 py-1.5 text-xs font-medium text-ink/60 hover:border-ink hover:text-ink transition-colors"
            >
              + New group
            </Link>
          </div>
        </div>

        <div className="text-sm">
          <span className="mb-1 block text-ink/60">People to include</span>
          <FriendPicker
            emails={emails}
            onChange={setEmails}
            currentUser={cachedCurrentUser}
            onPendingTextChange={setPickerHasPendingText}
          />
        </div>

        <div className="text-sm">
          <span className="mb-1 block text-ink/60">Only look at</span>
          <FiltersBuilder initial={filters} onChange={setFilters} />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={useThreshold} onChange={(e) => setUseThreshold(e.target.checked)} />
          <span className="text-ink/70">Only show slots with at least</span>
          <input
            type="number"
            min={1}
            max={emails.length + 1 || 1}
            value={minAttendeesField.text}
            onChange={minAttendeesField.onChange}
            onBlur={minAttendeesField.onBlur}
            disabled={!useThreshold}
            className="w-16 rounded-lg border border-line px-2 py-1 disabled:opacity-40"
          />
          <span className="text-ink/70">{minAttendeesField.numericValue === 1 ? "person" : "people"} free</span>
        </label>

        <div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={votingEnabled} onChange={(e) => setVotingEnabled(e.target.checked)} />
            <span className="text-ink/70">Participants vote for times</span>
          </label>
          <div className="accordion" data-open={votingEnabled}>
            <div className="accordion-inner">
              <label className="mt-2 flex items-center gap-2 pl-6 text-sm">
                <span className="text-ink/70">Participants vote for top</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={voteTopXField.text}
                  onChange={voteTopXField.onChange}
                  onBlur={voteTopXField.onBlur}
                  className="w-16 rounded-lg border border-line px-2 py-1"
                />
                <span className="text-ink/70">times</span>
              </label>
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={submitting || pickerHasPendingText} className="w-fit rounded-full bg-amber px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
          {submitting ? "Searching…" : "Start the search"}
        </button>
      </form>
    </main>
  );
}