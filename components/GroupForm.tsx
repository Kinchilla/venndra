"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import FriendPicker from "./FriendPicker";
import FiltersBuilder, { WeeklyHours } from "./FiltersBuilder";
import Toggle from "./Toggle";
import { buttonClass } from "../lib/buttonStyles";
import { takeGroupPrefill } from "../lib/groupPrefill";
import { markEventDraftForRestore } from "../lib/eventDraft";
import { hasSearchWindow } from "../lib/searchWindow";

export default function GroupForm({
  groupId,
  initialName = "",
  initialEmails = [],
  initialFilters,
  userDefaultFilters,
}: {
  groupId?: string;
  initialName?: string;
  initialEmails?: string[];
  initialFilters?: WeeklyHours;
  /** The user's own default search times from /settings, used to seed the picker when a group has no window of its own yet. */
  userDefaultFilters?: WeeklyHours | null;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const isEditing = !!groupId;

  const [name, setName] = useState(initialName);
  const [emails, setEmails] = useState<string[]>(initialEmails);
  // Seeded so the picker has something sensible the moment it's revealed: this
  // group's own window when editing, otherwise the user's personal default from
  // /settings. A handoff from the event form overrides both below, since those
  // are the times they were actively looking at seconds ago.
  const [filters, setFilters] = useState<WeeklyHours>(initialFilters ?? userDefaultFilters ?? {});

  // Whether this group defines a search window at all. Off means the group is
  // saved with none, and applying it on the event form leaves the times alone.
  // Editing an existing group starts in whatever state that group is already
  // in; a brand-new one starts off, which is what makes "optional" honest.
  const [customWindow, setCustomWindow] = useState(hasSearchWindow(initialFilters));
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pickerHasPendingText, setPickerHasPendingText] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [filtersVersion, setFiltersVersion] = useState(0);

  // Set when this visit came from the new-event form's "create a group" links.
  // Two effects: people are carried over so that flow doesn't make you retype
  // everyone, and saving returns you to the event you were part-way through
  // rather than leaving you stranded on a blank group form.
  const [cameFromEventForm, setCameFromEventForm] = useState(false);
  useEffect(() => {
    if (isEditing) return;
    const handoff = takeGroupPrefill();
    if (!handoff) return;
    setCameFromEventForm(true);
    if (handoff.emails.length > 0) {
      setEmails((prev) => [...prev, ...handoff.emails.filter((e) => !prev.includes(e))]);
    }
    // Carried times seed the picker but deliberately do NOT flip the toggle on.
    // The user asked to save these people as a group; whether the group should
    // also pin a search window is a separate decision, and making it for them
    // would quietly attach times they never opted into.
    if (hasSearchWindow(handoff.filters)) {
      setFilters(handoff.filters);
      setFiltersVersion((v) => v + 1);
    }
    // Intentionally mount-only: this consumes a one-shot stash, so re-running
    // it on isEditing changes would find nothing anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Same "default to including yourself, but only once" pattern as the
  // new-event form -- and only for a brand-new group, never when editing
  // an existing one (that already has its own real membership).
  const [selfPrefilled, setSelfPrefilled] = useState(false);
  useEffect(() => {
    if (!isEditing && session?.user?.email && !selfPrefilled) {
      setEmails((prev) => (prev.includes(session.user!.email!) ? prev : [session.user!.email!, ...prev]));
      setSelfPrefilled(true);
    }
  }, [isEditing, session, selfPrefilled]);

  // Cache this once known, rather than re-deriving it fresh from
  // useSession() on every render -- that hook can transiently report
  // nothing during background revalidation, which was causing the self
  // chip to flicker out of existence for no real reason (the underlying
  // email was always still there in `emails`, this is purely a display
  // issue with re-deriving from a source that isn't always stable).
  const [cachedCurrentUser, setCachedCurrentUser] = useState<{ email: string; name: string | null; image: string | null } | null>(null);
  useEffect(() => {
    if (session?.user?.email) {
      setCachedCurrentUser({ email: session.user.email, name: session.user.name ?? null, image: session.user.image ?? null });
    }
  }, [session]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pickerHasPendingText) {
      setError('Finish adding or clear the text in "Friends" before saving.');
      return;
    }
    if (emails.length === 0) {
      setError("Add at least one friend's email.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const res = await fetch(isEditing ? `/api/groups/${groupId}` : "/api/groups", {
      method: isEditing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      // Explicit null, not an omitted field or `{}`: null is what tells the API
      // to clear any window this group had, which matters when editing a group
      // whose toggle was just switched off.
      body: JSON.stringify({ name, emails, defaultFilters: customWindow ? filters : null }),
    });

    setSubmitting(false);
    if (!res.ok) {
      setError("Couldn't save that group.");
      return;
    }

    if (isEditing) {
      router.push("/groups");
      router.refresh();
      return;
    }

    // Arrived mid-way through organising an event: go back to it. The event
    // form keeps its own sessionStorage draft, restored on mount, so everything
    // already typed comes back untouched -- this only has to return there. The
    // refresh matters for more than the /groups cache here: /events/new renders
    // its saved-group chips server-side, so without it the group just created
    // wouldn't be among them.
    if (cameFromEventForm) {
      // The event form only restores its draft when asked. This is the ask --
      // without it they'd arrive at a blank form having just been pulled away
      // from a half-filled one.
      markEventDraftForRestore();
      router.push("/events/new");
      router.refresh();
      return;
    }

    // Creating: stay on the page and clear the form instead of navigating
    // away, so several groups can be saved back-to-back. Still refresh --
    // otherwise a cached /groups Router Cache entry from before this group
    // existed gets served if the user hits Back instead of the nav link.
    setName("");
    setEmails(session?.user?.email ? [session.user.email] : []);
    setFilters(userDefaultFilters ?? {});
    setCustomWindow(false);
    setFiltersVersion((v) => v + 1);
    setSaved(true);
    router.refresh();
  }

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [saved]);

  async function handleDelete() {
    if (!groupId) return;
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
    setDeleting(true);
    const res = await fetch(`/api/groups/${groupId}`, { method: "DELETE" });
    setDeleting(false);
    if (res.ok) {
      router.push("/groups");
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 grid gap-5">
      <label className="text-sm">
        <span className="mb-1 block text-ink/60">Group name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Family Dinner Crew"
          required
          className="w-full rounded-lg border border-line px-3 py-2"
        />
      </label>

      <label className="text-sm">
        <span className="mb-1 block text-ink/60">Friends</span>
        <FriendPicker
          emails={emails}
          onChange={setEmails}
          onPendingTextChange={setPickerHasPendingText}
          currentUser={cachedCurrentUser}
        />
      </label>

      <div className="text-sm">
        <div className="mb-1">
          <Toggle
            checked={customWindow}
            onChange={setCustomWindow}
            label={<span className="text-ink/60">Custom search window</span>}
          />
        </div>
        {customWindow ? (
          // `initial={filters}` rather than the initialFilters prop, so the
          // picker opens on whatever seeded it -- carried-over times, or the
          // user's own /settings default -- instead of always blank for a new
          // group. Toggling off and back on keeps any edits made in between,
          // since the state outlives the picker being unmounted.
          <FiltersBuilder key={filtersVersion} initial={filters} onChange={setFilters} />
        ) : (
          <p className="text-xs text-ink/40">
            This group won't set any times. Picking it on a new event leaves the search window as you left it.
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && <p className="text-sm text-teal">Saved!</p>}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={submitting || pickerHasPendingText} className={buttonClass({ variant: "primary", size: "lg", className: "w-fit" })}>
          {submitting ? "Saving…" : isEditing ? "Save changes" : "Save group"}
        </button>
        {isEditing && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="text-sm text-ink/40 hover:text-red-600 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete group"}
          </button>
        )}
      </div>
    </form>
  );
}
