"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { addMonths } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { useSearchParams } from "next/navigation";
import FriendPicker from "./FriendPicker";
import FiltersBuilder, { WeeklyHours } from "./FiltersBuilder";
import BackButton from "./BackButton";
import { useClientValue } from "../hooks/useClientValue";
import { buttonClass } from "../lib/buttonStyles";
import { stashGroupPrefill } from "../lib/groupPrefill";
import {
  clearEventDraftRestoreFlag,
  EVENT_DRAFT_KEY,
  hasEventDraftRestoreFlag,
  readSubstantiveEventDraft,
} from "../lib/eventDraft";
import { hasSearchWindow } from "../lib/searchWindow";
import Toggle from "./Toggle";
import Button from "./Button";

type SavedGroup = { id: string; name: string; emails: string[]; defaultFilters: WeeklyHours | null };

function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isoToLocalDateString(iso: string, timezone: string): string {
  return localDateString(toZonedTime(new Date(iso), timezone));
}

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

// CHANGED: now takes initialDefaultFilters as a prop, fetched server-side
// by the parent page.tsx -- this replaces the old `useState<WeeklyHours>({})`.
export default function NewEventForm({ initialDefaultFilters }: { initialDefaultFilters: WeeklyHours | null }) {
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
  // Deliberately NOT seeded from new Date() here -- see the effect below
  // that fills these in client-only, after mount.
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  // Same reasoning as the effect below, for the "Search from" input's own
  // min attribute -- kept separate since it's a plain read-only derived
  // value (never edited), unlike startDate/endDate themselves.
  const todayLocal = useClientValue(() => localDateString(new Date()), "");
  const [emails, setEmails] = useState<string[]>([]);
  // False until the sessionStorage draft has been read (or ruled out). Guards
  // the persist effect below from writing blank initial state over a real draft.
  const [draftLoaded, setDraftLoaded] = useState(false);

  // Whether this particular arrival should bring the saved draft back. Read
  // once during the first render (non-destructively, so StrictMode's second
  // render sees the same answer) and consumed in an effect below. Captured in
  // state so every effect this render decides from the same value, rather than
  // whichever of them happened to read sessionStorage first.
  const [shouldRestoreDraft] = useState(() => hasEventDraftRestoreFlag());
  useEffect(() => {
    clearEventDraftRestoreFlag();
  }, []);

  // An unfinished event found on an ordinary arrival -- offered rather than
  // applied. Captured during the FIRST render, which matters: the persist
  // effect overwrites storage with this (blank) form's state moments later, so
  // by the time the banner is on screen the stored copy is already gone. What
  // the Restore button applies is this in-memory snapshot.
  //
  // Read in a lazy initializer for the same reason as the flag above -- renders
  // happen before any effect writes, and StrictMode's second render pass reads
  // the same untouched value. Skipped entirely when the draft is about to be
  // restored automatically, so the two paths can't both fire.
  const [offeredDraft, setOfferedDraft] = useState<Record<string, unknown> | null>(() =>
    hasEventDraftRestoreFlag() ? null : readSubstantiveEventDraft()
  );

  /** Applies a stored draft to the form. Shared by the automatic restore and the Restore button, so they can never diverge on which fields come back. */
  function applyDraft(draft: any) {
    if (typeof draft.title === "string") setTitle(draft.title);
    if (typeof draft.description === "string") setDescription(draft.description);
    if (typeof draft.location === "string") setLocation(draft.location);
    if (typeof draft.durationHours === "number") durationHoursField.setValue(draft.durationHours);
    if (typeof draft.durationMinutes === "number") durationMinutesField.setValue(draft.durationMinutes);
    if (typeof draft.startDate === "string") setStartDate(draft.startDate);
    if (typeof draft.endDate === "string") setEndDate(draft.endDate);
    if (draft.filters) setFiltersFromExternalSource(draft.filters);
    if (typeof draft.useThreshold === "boolean") setUseThreshold(draft.useThreshold);
    if (typeof draft.minAttendees === "number") minAttendeesField.setValue(draft.minAttendees);
    if (typeof draft.votingEnabled === "boolean") setVotingEnabled(draft.votingEnabled);
    if (typeof draft.voteTopX === "number") voteTopXField.setValue(draft.voteTopX);
    if (Array.isArray(draft.emails)) {
      setEmails(draft.emails);
      // Read the recorded flag rather than assuming true. Assuming meant an
      // absent organiser was treated as "they removed themselves on purpose",
      // when it could equally be a draft written in the moment before the
      // self-prefill effect ran (useSession resolves asynchronously, so there's
      // a real window where emails is legitimately empty). Getting that wrong
      // dropped the organiser from their own event.
      setSelfPrefilled(draft.selfPrefilled === true);
    }
  }
  // CHANGED: seeded from the personal default (if any) instead of always {}.
  // An absent default still falls through to {} -> FiltersBuilder's own
  // hardcoded fallback, same as before.
  const [filters, setFilters] = useState<WeeklyHours>(() => initialDefaultFilters ?? {});
  // CHANGED: bumped whenever `filters` is overwritten from an EXTERNAL
  // source (a saved group, or the fromEvent prefill) rather than from the
  // user editing the picker themselves. FiltersBuilder is keyed on this,
  // forcing a fresh instance (and therefore a fresh lazy-init from the new
  // `initial` value) instead of silently going stale.
  const [filtersVersion, setFiltersVersion] = useState(0);
  const [useThreshold, setUseThreshold] = useState(true);
  const minAttendeesField = useNumberField(1, 1);
  const [votingEnabled, setVotingEnabled] = useState(false);
  const voteTopXField = useNumberField(3, 1);

  const [submitting, setSubmitting] = useState(false);
  const [pickerHasPendingText, setPickerHasPendingText] = useState(false);
  // Someone on the guest list has paused their account. Not something the
  // picker can stop happening -- a saved group, a fromEvent prefill or a
  // restored draft can all carry a person who paused in the meantime -- so
  // the form holds submission back until they're taken out. The picker names
  // who, directly under the list, so nothing extra needs saying here.
  const [pickerHasPausedSelection, setPickerHasPausedSelection] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // CHANGED: new helper -- the single place that overwrites `filters` from
  // outside the picker's own editing flow. Anything calling this should
  // also want the visible FiltersBuilder to reset and reflect it.
  function setFiltersFromExternalSource(next: WeeklyHours) {
    setFilters(next);
    setFiltersVersion((v) => v + 1);
  }

  useEffect(() => {
    fetch("/api/groups")
      .then((r) => r.json())
      .then((d) => setGroups(d.groups ?? []));
  }, []);

  // Fills in "today" / "today + 1 month" as the default search window,
  // client-only, after mount -- computing this from new Date() during the
  // initial render would use the SERVER's system clock (Node's local-time
  // getters reflect wherever the process actually runs, typically UTC),
  // which very routinely disagrees with the visitor's own browser timezone
  // on what day it currently is (e.g. any evening in a UTC-negative
  // timezone is already "tomorrow" in UTC) -- rendering that into a
  // hydrated <input value> crashes with a hydration mismatch. Skipped when
  // either the fromEvent prefill or the sessionStorage draft below is about
  // to fill these fields instead -- both take priority over this generic
  // default, and (for fromEvent specifically) the prefillLoading gate below
  // keeps the form hidden until that prefill lands anyway, so there's
  // nothing user-visible to race even without this guard.
  useEffect(() => {
    if (searchParams.get("fromEvent")) return;
    // Skipped only when a draft is genuinely about to be restored over these.
    // Previously this checked merely whether a draft EXISTED, which meant an
    // old abandoned draft suppressed the date defaults on a form that then
    // started blank -- leaving both date fields empty.
    if (shouldRestoreDraft) return;
    setStartDate(localDateString(new Date()));
    setEndDate(localDateString(addMonths(new Date(), 1)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [selfPrefilled, setSelfPrefilled] = useState(false);
  useEffect(() => {
    if (session?.user?.email && !selfPrefilled) {
      setEmails((prev) => (prev.includes(session.user!.email!) ? prev : [session.user!.email!, ...prev]));
      setSelfPrefilled(true);
    }
  }, [session, selfPrefilled]);

  const [prefilledFromEvent, setPrefilledFromEvent] = useState(false);
  // True only while a fromEvent prefill fetch is actually in flight -- lets
  // the render below hold the form back until it lands. Without this, the
  // form is interactive (and every field defaults to its normal blank/self
  // state) the instant the page mounts, while this fetch is still loading in
  // the background; if the user touches anything -- e.g. re-adding someone
  // via FriendPicker -- before it resolves, its `set*` calls below
  // unconditionally overwrite whatever the user just entered, silently
  // discarding the edit the moment the slower fetch finally comes back.
  const [prefillLoading, setPrefillLoading] = useState(() => !!searchParams.get("fromEvent"));
  useEffect(() => {
    const fromEventId = searchParams.get("fromEvent");
    if (!fromEventId || prefilledFromEvent) return;
    setPrefilledFromEvent(true);
    setSelfPrefilled(true);

    fetch(`/api/events/${fromEventId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const event = data?.event;
        if (!event) return;

        setTitle(event.title);
        setDescription(event.description ?? "");
        setLocation(event.location ?? "");
        durationHoursField.setValue(Math.floor(event.durationMin / 60));
        durationMinutesField.setValue(event.durationMin % 60);
        setStartDate(isoToLocalDateString(event.searchStart, event.timezone));
        setEndDate(isoToLocalDateString(event.searchEnd, event.timezone));
        // CHANGED: was setFilters(event.filters ?? {})
        setFiltersFromExternalSource(event.filters ?? {});
        setUseThreshold(event.minAttendees != null);
        if (event.minAttendees != null) minAttendeesField.setValue(event.minAttendees);
        setVotingEnabled(event.votingEnabled);
        if (event.voteTopX != null) voteTopXField.setValue(event.voteTopX);
        setEmails(event.participants.map((p: any) => p.email));
      })
      .finally(() => setPrefillLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, prefilledFromEvent]);

  // Restores whatever was last typed if this page is revisited within the
  // same tab (e.g. clicking Back after submitting, to retry) -- but only
  // when there's no fromEvent prefill in progress, since that's a more
  // specific, authoritative source for the same fields and should win.
  useEffect(() => {
    // draftLoaded is set on EVERY exit path, including the early returns --
    // the save effect below refuses to run until it's true, so missing it
    // anywhere would mean the form silently stopped persisting.
    if (searchParams.get("fromEvent")) {
      setDraftLoaded(true);
      return;
    }
    // Restoring is opt-in per arrival, not automatic. Landing here from the
    // header, a bookmark, or a fresh tab gives a clean form even though a draft
    // is sitting in storage; only a flow that marked itself (today: saving a
    // group started from this form) brings it back.
    if (!shouldRestoreDraft) {
      setDraftLoaded(true);
      return;
    }
    const raw = typeof window !== "undefined" ? sessionStorage.getItem(EVENT_DRAFT_KEY) : null;
    if (!raw) {
      setDraftLoaded(true);
      return;
    }
    try {
      applyDraft(JSON.parse(raw));
    } catch {
      // Corrupt/unreadable draft -- ignore it rather than blocking the page.
    }
    setDraftLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persists the current form state on every change, so it survives
  // navigating away and back within the tab. Cheap enough to run on every
  // keystroke -- sessionStorage writes are synchronous and local.
  //
  // Gated on draftLoaded, and that gate is load-bearing rather than tidiness.
  // Effects run in declaration order within a commit, so on mount this used to
  // fire straight after the restore above -- but BEFORE the restore's setState
  // had flushed, meaning it captured the blank initial values and wrote them
  // over the very draft just read. React StrictMode then remounts in dev, and
  // the second restore read the blanked draft, so leaving /events/new and
  // coming back lost everything.
  useEffect(() => {
    if (!draftLoaded) return;
    const draft = {
      title,
      description,
      location,
      durationHours: durationHoursField.numericValue,
      durationMinutes: durationMinutesField.numericValue,
      startDate,
      endDate,
      filters,
      useThreshold,
      minAttendees: minAttendeesField.numericValue,
      votingEnabled,
      voteTopX: voteTopXField.numericValue,
      emails,
      // Distinguishes "the organiser isn't in this list because they took
      // themselves out" from "...because the session hadn't loaded yet when
      // this was written". Without it the restore can't tell, and guessing
      // either way is wrong half the time.
      selfPrefilled,
    };
    sessionStorage.setItem(EVENT_DRAFT_KEY, JSON.stringify(draft));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    draftLoaded,
    selfPrefilled,
    title,
    description,
    location,
    durationHoursField.numericValue,
    durationMinutesField.numericValue,
    startDate,
    endDate,
    filters,
    useThreshold,
    minAttendeesField.numericValue,
    votingEnabled,
    voteTopXField.numericValue,
    emails,
  ]);

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
      // Groups may have no search window of their own (the "Custom search
      // window" toggle left off). Those apply their PEOPLE without touching
      // the times, leaving whatever was already set here alone. hasSearchWindow
      // rather than a truthiness check because `{}` is truthy but means the
      // same "no opinion" -- see lib/searchWindow.
      if (hasSearchWindow(group.defaultFilters)) setFiltersFromExternalSource(group.defaultFilters);
    }
  }

  // Keeps the threshold satisfiable when the guest list shrinks. The input's
  // own `max` stops the spinner climbing too high, but it can't repair a value
  // that WAS valid and then stopped being so: set "at least 3", remove someone,
  // and 3 is suddenly unmeetable. Without this the search would run and return
  // nothing, with no visible reason.
  //
  // Deliberately keyed on the participant count alone, not on the field's
  // value, so it never interrupts mid-typing -- someone entering "12" for a
  // 15-person event passes through 1 and 2 without being yanked downward. A
  // typed value that's still too high when submitted is caught server-side
  // instead, which is the backstop that check exists for.
  useEffect(() => {
    const cap = Math.max(1, emails.length);
    if (minAttendeesField.numericValue > cap) minAttendeesField.setValue(cap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emails.length]);

  // The "you could save these people as a group" nudge. Counted excluding the
  // organiser, who is added automatically rather than typed -- two OTHER people
  // is the point where "this same set of people" starts to mean something, and
  // it keeps a one-on-one from being told to make a group of two.
  //
  // Suppressed whenever this exact set of people is ALREADY a saved group --
  // any of them, not just one clicked from the chips above. Checking the
  // applied group alone missed the case that matters most: coming back from
  // having just created a group from these very people, where the tip would
  // cheerfully suggest doing the thing they had that second finished doing.
  // Set comparison, so adding or removing anyone makes it relevant again.
  const typedFriendCount = emails.filter((e) => e !== cachedCurrentUser?.email).length;
  const isAlreadyASavedGroup = groups.some(
    (g) => g.emails.length === emails.length && g.emails.every((e) => emails.includes(e))
  );
  const showGroupTip = !isAlreadyASavedGroup && typedFriendCount >= 2;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pickerHasPendingText) {
      setError('Finish adding or clear the text in "People to include" before starting the search.');
      return;
    }
    if (pickerHasPausedSelection) {
      setError('Someone in "People to include" has paused their account — remove them to start the search.');
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

    if (!res.ok) {
      // Only reset the button on failure -- on success, leave it showing
      // "Searching…" right up until the redirect actually happens, rather
      // than flashing back to "Start the search" for the gap between this
      // await resolving and router.push completing (which briefly looked
      // like the search had failed).
      setSubmitting(false);
      const body = await res.json().catch(() => null);
      if (body?.code === "not-friends" && searchParams.get("fromEvent")) {
        // The server's own message says "invite," which reads oddly here --
        // editing carries over people who are already on the event, so the
        // fix is to remove them from "People to include" below, not to
        // befriend them. Only takes this branch while editing an existing
        // event (fromEvent set); a genuinely new search still gets the
        // server's own "invite"-flavored wording via the branch below.
        setError("Can't save -- you're not friends with everyone on this event.");
      } else if (typeof body?.error === "string") {
        setError(body.error);
      } else {
        setError("Couldn't create that search — check the fields above.");
      }
      return;
    }
    const { event } = await res.json();

    const fromEventId = searchParams.get("fromEvent");
    if (fromEventId) {
      fetch(`/api/events/${fromEventId}/cancel`, { method: "POST" }).catch(() => {});
    }

    sessionStorage.removeItem(EVENT_DRAFT_KEY);
    // justCreated=1 lets /events/[id] know this event was just created by
    // this exact submission, so its Back button can offer "redo this search
    // and cancel it" (same as Edit this search) instead of a generic back
    // navigation -- otherwise hitting Back and resubmitting leaves a
    // duplicate event behind rather than looking like a single edit.
    router.push(`/events/${event.id}?justCreated=1`);
  }

  if (prefillLoading) {
    return (
      <main className="mx-auto max-w-lg px-6 py-12">
        <BackButton fallbackHref="/events" />
        <h1 className="font-display text-2xl font-semibold">Find us a time</h1>
        <p className="mt-6 text-sm text-ink/50">Loading your existing search…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-6 py-12">
      <BackButton fallbackHref="/events" />
      <h1 className="font-display text-2xl font-semibold">Find us a time</h1>

      {/* Offered, never applied on its own -- the form starts blank and stays
          that way unless this is clicked. See lib/eventDraft for why arrival
          alone isn't treated as intent to resume. */}
      {offeredDraft && (
        // Sits directly on the page background -- no card. The buttons follow
        // the sentence in the same row rather than being pushed to the far
        // edge, so the offer reads as one line of prose with its two answers
        // attached. flex-wrap lets them drop below on narrow screens instead of
        // squeezing the text.
        <div className="mt-4 flex flex-wrap items-center gap-1">
          <p className="text-sm text-ink/70">
            You have an unfinished event draft
            {typeof offeredDraft.title === "string" && offeredDraft.title.trim() !== ""
              ? `: "${offeredDraft.title}"`
              : ""}
          </p>
          {/* nav rather than quiet: both are borderless, but nav's text sits one
              step darker, which gives the action you'd usually want a little
              weight over Dismiss without reintroducing an outline. */}
          <Button
            type="button"
            variant="nav"
            size="sm"
            onClick={() => {
              applyDraft(offeredDraft);
              setOfferedDraft(null);
            }}
          >
            Restore it
          </Button>
          <Button type="button" variant="quiet" size="sm" onClick={() => setOfferedDraft(null)}>
            Dismiss
          </Button>
        </div>
      )}

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
              min={todayLocal}
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
                // No lasting "selected" styling: clicking a group COPIES its
                // people in, it doesn't bind the form to that group. Keeping a
                // chip highlighted afterwards claimed a link that the first
                // edit to the list quietly broke. The shared active state fills
                // it for the duration of the press instead, which acknowledges
                // the click without asserting anything after it.
                className={buttonClass({ variant: "edit", size: "sm" })}
              >
                {g.name}
              </button>
            ))}
            {/*
              Only offered when there are no saved groups to start from. With
              groups present this section is for picking one, and leaving
              halfway through organising an event to go build a group is an odd
              detour to advertise there -- the tip under "People to include"
              catches that case at the moment it's actually relevant instead.
              Groups also remain a permanent nav link in the header, so this
              isn't the only way to find the feature.
            */}
            {groups.length === 0 && (
              <Link
                href="/groups/new"
                onClick={() => stashGroupPrefill(emails, filters)}
                className={buttonClass({ variant: "edit", size: "sm" })}
              >
                Create a group
              </Link>
            )}
          </div>
        </div>

        <div className="text-sm">
          <span className="mb-1 block text-ink/60">People to include</span>
          <FriendPicker
            emails={emails}
            onChange={setEmails}
            currentUser={cachedCurrentUser}
            onPendingTextChange={setPickerHasPendingText}
            onPausedSelectionChange={setPickerHasPausedSelection}
          />
          {showGroupTip && (
            <p className="mt-1.5 text-xs text-ink/50">
              Tip: if you often make plans with this same set of people, you can{" "}
              <Link href="/groups/new" onClick={() => stashGroupPrefill(emails, filters)} className="text-teal underline">
                create a group
              </Link>{" "}
              to make planning even easier!
            </p>
          )}
        </div>

        <div className="text-sm">
          <span className="mb-1 block text-ink/60">Only look at</span>
          {/* CHANGED: keyed on filtersVersion so a saved-group apply or a
              fromEvent prefill forces a genuinely fresh FiltersBuilder
              instance, instead of silently going stale. */}
          <FiltersBuilder key={filtersVersion} initial={filters} onChange={setFilters} />
        </div>

        {/*
          A <div>, not a <label>, unlike the voting row below: this sentence has
          a number input embedded in it, and a label wrapping two controls binds
          to the first one -- so clicking near the number used to flip the
          toggle. The switch carries its own label element and accessible name;
          the sentence beside it is now just text.
        */}
        <div className="flex items-center gap-2 text-sm">
          <Toggle
            checked={useThreshold}
            onChange={setUseThreshold}
            aria-label="Only show slots with a minimum number of people free"
          />
          <span className="text-ink/70">Only show slots with at least</span>
          <input
            type="number"
            min={1}
            // The ceiling is the participant count, and `emails` already
            // includes the organiser (it's pre-filled with their own address,
            // and the API builds participants from this list alone) -- the old
            // `emails.length + 1` double-counted them, offering a threshold
            // that could never be met. The `|| 1` fallback it carried was worse
            // than useless: with an empty list it evaluated to max=1, pinning
            // the field at its minimum so the spinner arrows did nothing at
            // all. Math.max keeps a valid max without reintroducing that.
            max={Math.max(1, emails.length)}
            value={minAttendeesField.text}
            onChange={minAttendeesField.onChange}
            onBlur={minAttendeesField.onBlur}
            disabled={!useThreshold}
            className="w-16 rounded-lg border border-line px-2 py-1 disabled:opacity-40"
          />
          <span className="text-ink/70">{minAttendeesField.numericValue === 1 ? "person" : "people"} free</span>
        </div>

        <div>
          <Toggle
            checked={votingEnabled}
            onChange={setVotingEnabled}
            labelPosition="after"
            label={<span className="text-sm text-ink/70">Participants vote for times</span>}
          />
          <div className="accordion" data-open={votingEnabled}>
            <div className="accordion-inner">
              {/* pl matches the switch's 44px width plus the 8px gap, so this
                  nested row still lines up under the label text above it. */}
              <label className="mt-2 flex items-center gap-2 pl-[52px] text-sm">
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

        <button
          type="submit"
          disabled={submitting || pickerHasPendingText || pickerHasPausedSelection}
          className={buttonClass({ variant: "primary", size: "lg", className: "w-fit" })}
        >
          {submitting ? "Searching…" : "Start the search"}
        </button>
      </form>
    </main>
  );
}