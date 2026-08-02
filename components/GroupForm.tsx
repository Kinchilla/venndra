"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import FriendPicker from "./FriendPicker";
import FiltersBuilder, { WeeklyHours } from "./FiltersBuilder";

export default function GroupForm({
  groupId,
  initialName = "",
  initialEmails = [],
  initialFilters,
}: {
  groupId?: string;
  initialName?: string;
  initialEmails?: string[];
  initialFilters?: WeeklyHours;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const isEditing = !!groupId;

  const [name, setName] = useState(initialName);
  const [emails, setEmails] = useState<string[]>(initialEmails);
  const [filters, setFilters] = useState<WeeklyHours>(initialFilters ?? {});
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pickerHasPendingText, setPickerHasPendingText] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [filtersVersion, setFiltersVersion] = useState(0);

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
      body: JSON.stringify({ name, emails, defaultFilters: filters }),
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

    // Creating: stay on the page and clear the form instead of navigating
    // away, so several groups can be saved back-to-back. Still refresh --
    // otherwise a cached /groups Router Cache entry from before this group
    // existed gets served if the user hits Back instead of the nav link.
    setName("");
    setEmails(session?.user?.email ? [session.user.email] : []);
    setFilters({});
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
        <span className="mb-1 block text-ink/60">Default search windows (optional)</span>
        <FiltersBuilder key={filtersVersion} initial={initialFilters} onChange={setFilters} />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && <p className="text-sm text-teal">Saved!</p>}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={submitting || pickerHasPendingText} className="w-fit rounded-full bg-amber px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
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
