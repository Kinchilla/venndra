"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useClientValue } from "../hooks/useClientValue";
import { buttonClass } from "../lib/buttonStyles";

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

  // Modern browsers expose the full IANA timezone database via Intl -- no
  // need to hand-maintain a list. Computed via useClientValue (client-only,
  // after mount) rather than during render: Intl.supportedValuesOf reads
  // whatever tzdata snapshot ships with the current runtime, and Node's
  // server-side ICU version can genuinely disagree with the browser's own
  // on the exact spelling of a legacy-alias zone (e.g. the server returning
  // "Africa/Asmera" where the browser returns the now-canonical
  // "Africa/Asmara" for the same zone) -- computing this during SSR and
  // hydrating against a different browser-computed list crashes with a
  // hydration mismatch. Falls back to just the current value pre-mount (and
  // permanently, if the browser doesn't support supportedValuesOf at all --
  // older Safari), so there's nothing for the server-rendered markup to
  // disagree with in the first place.
  const timezones = useClientValue<string[]>(
    () => {
      try {
        // @ts-ignore -- supportedValuesOf isn't in older TS lib definitions yet
        const all = Intl.supportedValuesOf("timeZone") as string[];
        return all.includes(initialTimezone) ? all : [initialTimezone, ...all];
      } catch {
        return [initialTimezone]; // older Safari -- no supportedValuesOf at all
      }
    },
    [initialTimezone],
    [initialTimezone]
  );

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
          className={buttonClass({ variant: "primary", size: "lg" })}
        >
          {submitting ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-sm text-teal">Saved</span>}
      </div>
    </form>
  );
}
