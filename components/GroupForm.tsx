"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import EmailListInput from "./EmailListInput";
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
  const [error, setError] = useState<string | null>(null);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
    router.push("/events");
    router.refresh();
  }

  async function handleDelete() {
    if (!groupId) return;
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
    setDeleting(true);
    const res = await fetch(`/api/groups/${groupId}`, { method: "DELETE" });
    setDeleting(false);
    if (res.ok) {
      router.push("/events");
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
        <EmailListInput emails={emails} onChange={setEmails} />
      </label>

      <div className="text-sm">
        <span className="mb-1 block text-ink/60">Default search windows (optional)</span>
        <FiltersBuilder initial={initialFilters} onChange={setFilters} />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={submitting} className="w-fit rounded-full bg-amber px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
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
