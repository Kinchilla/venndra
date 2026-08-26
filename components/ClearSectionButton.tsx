"use client";

import { useRouter } from "next/navigation";
import { usePendingAction } from "../hooks/usePendingAction";

export default function ClearSectionButton({ eventIds }: { eventIds: string[] }) {
  const router = useRouter();
  // Stays inactive until the refreshed section has committed -- the whole
  // section (this button included) goes with it. See hooks/usePendingAction.
  const { pending, busy, begin, commit } = usePendingAction<"clear">();

  if (eventIds.length === 0) return null;

  async function handleClear() {
    if (
      !confirm(
        "This will permanently delete all of the events in this section from Venndra, which cannot be undone. It will not affect your linked calendars. Are you sure you want to clear this section?"
      )
    )
      return;
    begin("clear");
    await Promise.all(eventIds.map((id) => fetch(`/api/events/${id}`, { method: "DELETE" })));
    commit(() => router.refresh());
  }

  return (
    <button onClick={handleClear} disabled={busy} className="text-sm text-ink/40 hover:text-red-600 disabled:opacity-50">
      {pending === "clear" ? "Clearing…" : "Clear"}
    </button>
  );
}
