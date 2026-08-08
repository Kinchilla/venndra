"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "./Button";
import { CALENDARS_CHANGED_EVENT, dispatchCalendarsChanged } from "../lib/calendarEvents";

type Account = {
  id: string;
  provider: string;
  accountEmail: string | null;
  label: string;
  confirmedEventCount: number;
  disconnectBlockedReason: string | null;
  holdsWriteTarget: boolean;
  isLoginMethod: boolean;
};

const PROVIDER_LABEL: Record<string, string> = { GOOGLE: "Google", MICROSOFT: "Microsoft", APPLE_CALDAV: "iCloud" };

/**
 * Spells out the specific consequences for THIS account rather than hedging
 * with "if this was your write target..." clauses -- same reasoning as the
 * cancel/leave dialogs on EventChip: Venndra already knows which of these
 * apply, so the person reading the dialog shouldn't have to work it out.
 *
 * Disconnecting is permanent, so the dialog has to carry more weight than it
 * did when this was a reversible toggle: it names what reconnecting will cost
 * (a fresh authorization, or re-entering an app-specific password) rather than
 * letting the user discover that afterward.
 */
function disconnectConfirmText(account: Account) {
  const name = account.accountEmail ?? account.label;

  const writeTargetNote = account.holdsWriteTarget
    ? " New events are currently saved to this account -- Venndra will move that to another connected calendar."
    : "";

  // Only accounts that AREN'T the identity one can reach this dialog, so the
  // OAuth wording can state the release plainly: signing in with it afterwards
  // starts a separate Venndra account, which is surprising enough to say up
  // front rather than let someone discover it. Apple's credential lives on the
  // row being deleted, hence the note about needing a freshly generated
  // password rather than the old one.
  const reconnectNote = account.isLoginMethod
    ? "Venndra will forget this account entirely -- reconnecting means authorizing it again, and signing in with it instead would start a separate Venndra account. The account you normally sign in with is unaffected."
    : "Venndra will forget this account entirely, including its stored app-specific password, so reconnecting means entering a new one.";

  return `Disconnect ${name}? Its calendars will stop counting toward your availability.${writeTargetNote} ${reconnectNote}`;
}

export default function ConnectedAccountsSection() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/calendars/accounts")
      .then((r) => r.json())
      .then((d) => setAccounts(d.accounts ?? []));
  }, []);

  useEffect(() => {
    load();
    // Connecting an account elsewhere on this page changes this list too.
    window.addEventListener(CALENDARS_CHANGED_EVENT, load);
    return () => window.removeEventListener(CALENDARS_CHANGED_EVENT, load);
  }, [load]);

  async function disconnect(id: string) {
    setPendingId(id);
    setError(null);

    const res = await fetch(`/api/calendars/accounts/${id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      setPendingId(null);
      setError(body.error ?? "Couldn't disconnect that account. Try again.");
      // Re-read regardless: a stale confirmedEventCount is the most likely
      // reason a disconnect the UI thought was allowed got rejected.
      load();
      return;
    }

    // Drop the row here rather than waiting for the refetch below to bring back
    // a list without it. Clearing pendingId while the old row is still rendered
    // hands back a live "Disconnect account" button for an account that no
    // longer exists -- clickable, and good for a second DELETE that 404s. These
    // two updates batch into one render, so the row and its button go together.
    // (CalendarSourcesPanel already takes this optimistic approach for its own
    // toggles, for the same reason.)
    setAccounts((prev) => (prev ? prev.filter((a) => a.id !== id) : prev));
    setPendingId(null);

    // Still refetch, via the shared event: this component's own listener
    // reconciles the optimistic removal against the server, and
    // CalendarSourcesPanel re-syncs -- which matters beyond refreshing its
    // list, since disconnecting drops the write target if it lived on this
    // account and the sync is what assigns a new one. Passing the id lets the
    // panel drop those calendars straight away rather than showing them for
    // the several seconds that sync takes.
    dispatchCalendarsChanged({ disconnectedCalendarId: id });
  }

  if (!accounts) return <p className="mt-3 text-sm text-ink/50">Loading accounts…</p>;
  if (accounts.length === 0) return <p className="mt-3 text-sm text-ink/50">No accounts connected yet.</p>;

  return (
    <div className="mt-3">
      {error && (
        <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      <ul className="divide-y divide-line/60 border-y border-line/60">
        {accounts.map((account) => (
          <li key={account.id} className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm text-ink/80">{account.accountEmail ?? account.label}</div>
              <div className="text-xs text-ink/40">
                {PROVIDER_LABEL[account.provider] ?? account.provider}
                {account.confirmedEventCount > 0 && (
                  <>
                    {" · holding "}
                    {account.confirmedEventCount} upcoming event{account.confirmedEventCount === 1 ? "" : "s"}
                  </>
                )}
              </div>
            </div>

            <Button
              variant="danger"
              confirm={() => disconnectConfirmText(account)}
              onClick={() => disconnect(account.id)}
              disabled={!!account.disconnectBlockedReason || pendingId === account.id}
              title={account.disconnectBlockedReason ?? undefined}
              // Disabled is a normal resting state for this button (only
              // calendar, only login, or holding confirmed events), not a brief
              // in-flight blip -- so it fades harder than the shared default
              // and drops the hover affordance entirely.
              className="shrink-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink/70"
            >
              {pendingId === account.id ? "Disconnecting…" : "Disconnect account"}
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink/40">
        The account you sign into Venndra with can't be disconnected — it's how Venndra knows who you are. Any other
        account can be: disconnecting removes it completely, so reconnecting means authorizing again (or, for iCloud,
        generating a new app-specific password).
      </p>
    </div>
  );
}
