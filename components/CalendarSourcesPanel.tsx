"use client";

import { useCallback, useEffect, useState } from "react";
import { CALENDARS_CHANGED_EVENT, readCalendarsChanged } from "../lib/calendarEvents";

type Source = { id: string; externalId: string; label: string; checkAvailability: boolean; isWriteTarget: boolean };
type CalendarAccount = {
  id: string;
  provider: string;
  label: string;
  accountEmail: string | null;
  isEnabled: boolean;
  sources: Source[];
};
type Row = { source: Source; account: CalendarAccount };

const PROVIDER_LABEL: Record<string, string> = { GOOGLE: "Google", MICROSOFT: "Microsoft", APPLE_CALDAV: "iCloud" };

export default function CalendarSourcesPanel() {
  const [calendars, setCalendars] = useState<CalendarAccount[] | null>(null);

  const load = useCallback((sync = false) => {
    fetch(`/api/calendars${sync ? "?sync=1" : ""}`)
      .then((r) => r.json())
      .then((d) => setCalendars(d.calendars ?? []));
  }, []);

  useEffect(() => {
    load(true);

    // Disconnecting an account elsewhere on this page removes its calendars
    // from this list -- and re-syncs, which is what re-assigns a write target
    // when the disconnected account happened to hold it.
    //
    // The removal is applied optimistically first: load(true) hits
    // /api/calendars?sync=1, which round-trips to every remaining provider
    // before answering, and leaving the disconnected account's calendars
    // on screen for that long looks like the disconnect didn't take.
    const onCalendarsChanged = (event: Event) => {
      const { disconnectedCalendarId } = readCalendarsChanged(event);
      if (disconnectedCalendarId) {
        setCalendars((prev) => (prev ? prev.filter((c) => c.id !== disconnectedCalendarId) : prev));
      }
      load(true);
    };
    window.addEventListener(CALENDARS_CHANGED_EVENT, onCalendarsChanged);
    return () => window.removeEventListener(CALENDARS_CHANGED_EVENT, onCalendarsChanged);
  }, [load]);

  async function toggleCheck(sourceId: string, checkAvailability: boolean) {
    setCalendars((prev) =>
      prev
        ? prev.map((account) => ({
            ...account,
            sources: account.sources.map((s) => (s.id === sourceId ? { ...s, checkAvailability } : s)),
          }))
        : prev
    );

    const res = await fetch(`/api/calendars/sources/${sourceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkAvailability }),
    });

    if (!res.ok) {
      setCalendars((prev) =>
        prev
          ? prev.map((account) => ({
              ...account,
              sources: account.sources.map((s) => (s.id === sourceId ? { ...s, checkAvailability: !checkAvailability } : s)),
            }))
          : prev
      );
    }
  }

  async function setWriteTarget(sourceId: string) {
    const previous = calendars;
    setCalendars((prev) =>
      prev
        ? prev.map((account) => ({
            ...account,
            sources: account.sources.map((s) => ({ ...s, isWriteTarget: s.id === sourceId })),
          }))
        : prev
    );

    const res = await fetch(`/api/calendars/sources/${sourceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isWriteTarget: true }),
    });

    if (!res.ok) {
      setCalendars(previous);
    }
  }

  if (!calendars) return <p className="text-sm text-ink/50">Loading calendars…</p>;

  const rows: Row[] = calendars.flatMap((account) => account.sources.map((source) => ({ source, account })));

  if (rows.length === 0) return <p className="text-sm text-ink/50">No calendars connected yet.</p>;

  return (
    <div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs font-normal text-ink/50">
            <th className="py-2 pr-2 font-normal">Calendar</th>
            <th className="w-36 py-2 px-2 text-center font-normal">Count toward availability</th>
            <th className="w-32 py-2 pl-2 text-center font-normal">Save new events here</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ source, account }) => (
            <tr
              key={source.id}
              className={`border-b border-line/60 transition-colors ${
                source.isWriteTarget ? "bg-[rgba(63,143,92,0.16)]" : "hover:bg-[rgba(63,143,92,0.08)]"
              }`}
            >
              <td className="py-2.5 pr-2">
                <div className="text-ink/80">{source.label}</div>
                <div className="text-xs text-ink/40">
                  {/*
                    Prefer the provider account's own email -- with more than one
                    Google/Microsoft account connected, "Google · Google Calendar"
                    is both redundant and ambiguous about which account a calendar
                    came from. Falls back to the generic label for rows with no
                    stored email (e.g. Microsoft accounts that return no email claim).
                  */}
                  {PROVIDER_LABEL[account.provider] ?? account.provider} · {account.accountEmail ?? account.label}
                </div>
              </td>
              <td className="py-2.5 px-2 text-center">
                <input
                  type="checkbox"
                  checked={source.checkAvailability}
                  onChange={(e) => toggleCheck(source.id, e.target.checked)}
                />
              </td>
              <td className="py-2.5 pl-2 text-center">
                <input
                  type="radio"
                  name="writeTarget"
                  checked={source.isWriteTarget}
                  onChange={() => setWriteTarget(source.id)}
                  title={
                    account.provider === "APPLE_CALDAV"
                      ? "Events confirmed here won't send real invites to other attendees -- you'll need to invite them yourself"
                      : undefined
                  }
                />
                {account.provider === "APPLE_CALDAV" && (
                  <div className="mt-0.5 text-[10px] leading-tight text-ink/40">No auto-invites</div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-ink/40">
        Unchecked calendars are ignored when Venndra checks your availability — handy for things like a shared
        "US Holidays" calendar that shouldn't block a hangout.
      </p>
      {rows.some((r) => r.account.provider === "APPLE_CALDAV") && (
        <p className="mt-1.5 text-xs text-ink/40">
          Events confirmed through your Apple Calendar won't send real invites to other attendees — you'll need to
          invite them yourself.
        </p>
      )}
    </div>
  );
}