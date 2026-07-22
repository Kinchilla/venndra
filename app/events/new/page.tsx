"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { addMonths } from "date-fns";
import EmailListInput from "../../../components/EmailListInput";
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

export default function NewEventPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [groups, setGroups] = useState<SavedGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const [title, setTitle] = useState("Family Dinner");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [durationHours, setDurationHours] = useState(2);
  const [durationMinutes, setDurationMinutes] = useState(0);
  const durationMin = durationHours * 60 + durationMinutes;
  const [startDate, setStartDate] = useState(() => localDateString(new Date()));
  const [endDate, setEndDate] = useState(() => localDateString(addMonths(new Date(), 1)));
  const [emails, setEmails] = useState<string[]>([]);
  const [filters, setFilters] = useState<WeeklyHours>({});
  const [useThreshold, setUseThreshold] = useState(true);
  const [minAttendees, setMinAttendees] = useState(1);
  const [votingEnabled, setVotingEnabled] = useState(false);
  const [voteTopX, setVoteTopX] = useState(3);

  const [submitting, setSubmitting] = useState(false);
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
        minAttendees: useThreshold ? minAttendees : undefined,
        votingEnabled,
        voteTopX: votingEnabled ? voteTopX : undefined,
        emails,
      }),
    });

    setSubmitting(false);
    if (!res.ok) {
      setError("Couldn't create that search — check the fields above.");
      return;
    }
    const { event } = await res.json();
    router.push(`/events/${event.id}`);
  }

  return (
    <main className="mx-auto max-w-lg px-6 py-12">
      <BackButton fallbackHref="/events" />
      <h1 className="font-display text-2xl font-semibold">Find us a time</h1>
      <p className="mt-1 text-ink/60">Everyone below needs to connect a calendar to be counted.</p>

      {groups.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-sm text-ink/60">Start from a saved group</p>
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <button
                type="button"
                key={g.id}
                onClick={() => applyGroup(g.id)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  selectedGroupId === g.id ? "border-amber bg-amber/10 text-amber" : "border-line text-ink/60"
                }`}
              >
                {g.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 grid gap-5">
        <label className="text-sm">
          <span className="mb-1 block text-ink/60">Event name</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required className="w-full rounded-lg border border-line px-3 py-2" />
        </label>

        <div className="text-sm">
          <span className="mb-1 block text-ink/60">Length</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={24}
              step={1}
              value={durationHours}
              onChange={(e) => setDurationHours(Number(e.target.value))}
              className="w-16 rounded-lg border border-line px-2 py-2 text-center"
            />
            <span className="text-ink/60">hours</span>
            <input
              type="number"
              min={0}
              max={59}
              step={5}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
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

        <label className="text-sm">
          <span className="mb-1 block text-ink/60">People to include</span>
          <EmailListInput emails={emails} onChange={setEmails} />
        </label>

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
            value={minAttendees}
            onChange={(e) => setMinAttendees(Number(e.target.value))}
            disabled={!useThreshold}
            className="w-16 rounded-lg border border-line px-2 py-1 disabled:opacity-40"
          />
          <span className="text-ink/70">{minAttendees === 1 ? "person" : "people"} free</span>
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
                  value={voteTopX}
                  onChange={(e) => setVoteTopX(Number(e.target.value))}
                  className="w-16 rounded-lg border border-line px-2 py-1"
                />
                <span className="text-ink/70">times</span>
              </label>
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={submitting} className="w-fit rounded-full bg-amber px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
          {submitting ? "Searching…" : "Start the search"}
        </button>
      </form>
    </main>
  );
}
