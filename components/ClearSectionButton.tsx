"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ClearSectionButton({ eventIds }: { eventIds: string[] }) {
  const router = useRouter();
  const [clearing, setClearing] = useState(false);

  if (eventIds.length === 0) return null;

  async function handleClear() {
    if (
      !confirm(
        "This will permanently delete all of the events in this section from Venndra, which cannot be undone. It will not affect your linked calendars. Are you sure you want to clear this section?"
      )
    )
      return;
    setClearing(true);
    await Promise.all(eventIds.map((id) => fetch(`/api/events/${id}`, { method: "DELETE" })));
    setClearing(false);
    router.refresh();
  }

  return (
    <button onClick={handleClear} disabled={clearing} className="text-sm text-ink/40 hover:text-red-600 disabled:opacity-50">
      {clearing ? "Clearing…" : "Clear"}
    </button>
  );
}