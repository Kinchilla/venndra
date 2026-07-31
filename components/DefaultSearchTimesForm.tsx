"use client";

import { useState } from "react";
import FiltersBuilder, { WeeklyHours } from "./FiltersBuilder";

export default function DefaultSearchTimesForm({ initialFilters }: { initialFilters: WeeklyHours | null }) {
  const [filters, setFilters] = useState<WeeklyHours>(initialFilters ?? {});
  // Same key-remount pattern as NewEventForm -- needed here too, since
  // "Reset" needs to force FiltersBuilder back to its own hardcoded
  // default, not just clear our own `filters` state.
  const [version, setVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  async function save(value: WeeklyHours | null) {
    setSaving(true);
    setStatus("idle");
    const res = await fetch("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultSearchFilters: value }),
    });
    setSaving(false);
    setStatus(res.ok ? "saved" : "error");
  }

  function handleReset() {
    setFilters({});
    setVersion((v) => v + 1);
    save(null);
  }

  return (
    <div>
      <FiltersBuilder key={version} initial={filters} onChange={setFilters} />
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => save(filters)}
          disabled={saving}
          className="rounded-full bg-amber px-4 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save default"}
        </button>
        <button
          type="button"
          onClick={handleReset}
          disabled={saving}
          className="text-xs text-ink/50 hover:text-ink disabled:opacity-50"
        >
          Reset to app default
        </button>
        {status === "saved" && <span className="text-xs text-teal">Saved</span>}
        {status === "error" && <span className="text-xs text-red-600">Couldn't save — try again.</span>}
      </div>
    </div>
  );
}