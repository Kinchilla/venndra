"use client";

import CalendarSourcesPanel from "./CalendarSourcesPanel";
import ConnectAppleForm from "./ConnectAppleForm";
import ConnectProviderButton from "./ConnectProviderButton";
import { dispatchCalendarsChanged } from "../lib/calendarEvents";

/**
 * CalendarSourcesPanel loads its own list on mount and doesn't re-fetch on
 * router.refresh() (that only re-renders server components -- this is a
 * client component with its own state), so a successful connect has to tell
 * it to reload explicitly. It listens for CALENDARS_CHANGED_EVENT, which the
 * "Connected accounts" section below also fires on disconnect/reconnect, so
 * one signal keeps both lists in sync no matter which one initiated.
 *
 * The Google/Microsoft buttons need no signal at all: those are a full-page
 * redirect out to the provider and back, so /settings fresh-mounts on return
 * and both lists load from scratch anyway. Only Apple's form, which never
 * leaves the page, has to announce itself.
 */
export default function ConnectedCalendarsSection() {
  return (
    <>
      <div className="mt-3">
        <CalendarSourcesPanel />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <ConnectProviderButton provider="google" />
        <ConnectProviderButton provider="azure-ad" />
        {/* No detail: a connect adds calendars rather than removing one, so
            there's nothing for listeners to drop optimistically. */}
        <ConnectAppleForm onConnected={() => dispatchCalendarsChanged()} />
      </div>
    </>
  );
}
