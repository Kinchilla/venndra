"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export default function ProfileForm({
  initialName,
  initialTimezone,
  image,
}: {
  initialName: string;
  initialTimezone: string;
  image: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);

  // Modern browsers expose the full IANA timezone database via Intl --
  // no need to hand-maintain a list. Falls back to just the current value
  // if the browser doesn't support it (older Safari).
  const timezones = useMemo(() => {
    try {
      // @ts-ignore -- supportedValuesOf isn't in older TS lib definitions yet
      return Intl.supportedValuesOf("timeZone") as string[];
    } catch {
      return [timezone];
    }
  }, [timezone]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSaved(false);

    const res = await fetch("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, timezone }),
    });

    setSubmitting(false);
    if (res.ok) {
      setSaved(true);
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-line bg-white p-6">
      <div className="flex items-center gap-4">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" referrerPolicy="no-referrer" className="h-14 w-14 rounded-full" />
        ) : (
          <div className="h-14 w-14 rounded-full bg-line" />
        )}
        <p className="text-xs text-ink/40">
          Your picture comes from whichever account you signed in with — Venndra doesn't support uploading a
          separate one yet.
        </p>
      </div>

      <label className="mt-5 block text-sm">
        <span className="mb-1 block text-ink/60">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full rounded-lg border border-line px-3 py-2"
        />
      </label>

      <label className="mt-4 block text-sm">
        <span className="mb-1 block text-ink/60">Timezone</span>
        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="w-full rounded-lg border border-line px-3 py-2"
        >
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-ink/40">Used as the default when you create a new search.</span>
      </label>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-full bg-amber px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-sm text-teal">Saved</span>}
      </div>
    </form>
  );
}
