"use client";

import { useState } from "react";
import CalendarSourcesPanel from "./CalendarSourcesPanel";
import ConnectAppleForm from "./ConnectAppleForm";

/**
 * CalendarSourcesPanel loads its own list on mount and doesn't re-fetch on
 * router.refresh() (that only re-renders server components -- this is a
 * client component with its own state). Bumping `refreshKey` after a
 * successful connect remounts the panel, which re-runs its load(true)
 * effect, so a freshly-connected calendar shows up immediately instead of
 * only after a manual page reload.
 */
export default function ConnectedCalendarsSection() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <>
      <div className="mt-3">
        <CalendarSourcesPanel key={refreshKey} />
      </div>
      <div className="mt-3">
        <ConnectAppleForm onConnected={() => setRefreshKey((k) => k + 1)} />
      </div>
    </>
  );
}
