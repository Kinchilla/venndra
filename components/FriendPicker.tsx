"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchJson } from "../lib/apiError";
import Link from "next/link";
import Avatar from "./Avatar";
import { displayName } from "../lib/displayName";
import { PAUSED_TAG, pausedInviteeMessage } from "../lib/pause";

type Friend = { id: string; name: string | null; email: string | null; image: string | null; paused: boolean };
type CurrentUser = { email: string; name: string | null; image: string | null };

export default function FriendPicker({
  emails,
  onChange,
  currentUser,
  onPendingTextChange,
  onPausedSelectionChange,
}: {
  emails: string[];
  onChange: (emails: string[]) => void;
  currentUser?: CurrentUser | null;
  onPendingTextChange?: (hasPendingText: boolean) => void;
  /**
   * Fires when someone already in the list turns out to be paused -- which
   * this picker can't prevent, only report: a saved group applied above, a
   * fromEvent prefill, or a restored draft can all put a person here who
   * paused since. Optional, and deliberately unused by the saved-group form:
   * see the note on validateNoPausedInvitees in lib/friends.ts for why a
   * group tolerates a paused member and a new event doesn't.
   */
  onPausedSelectionChange?: (hasPausedSelection: boolean) => void;
}) {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetchJson<{ friends?: { user: Friend }[] }>("/api/friends")
      .then((d) => setFriends((d.friends ?? []).map((f) => f.user)))
      // Same reasoning as ConnectedAccountsSection: a dropped request, or a
      // session that ended, must not become an unhandled rejection. Nothing to
      // show here -- the picker renders an empty friend list and still takes
      // typed email addresses.
      .catch(() => {});
  }, []);

  useEffect(() => {
    onPendingTextChange?.(query.trim().length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const available = useMemo(() => (friends ?? []).filter((f) => f.email && !emails.includes(f.email)), [friends, emails]);
  // Still matches on email even though no email is rendered any more, and that
  // split is deliberate -- it's the "does email stay searchable" question
  // issue #6 left open, answered as searchable but not displayable.
  //
  // The two aren't the same risk. Displaying an address hands it to someone
  // who didn't have it; matching one only confirms an address the searcher had
  // to type from memory, about a person who is already their friend. Taking it
  // away would break the perfectly ordinary case of knowing someone's address
  // and not which of their names they signed up under, and would protect
  // nobody, since this list is the searcher's own friends either way.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return available;
    return available.filter((f) => f.name?.toLowerCase().includes(q) || f.email?.toLowerCase().includes(q));
  }, [available, query]);

  function addFriend(email: string) {
    onChange([...emails, email]);
    setQuery("");
  }

  const selectedFriends = (friends ?? []).filter((f) => f.email && emails.includes(f.email));
  const includesSelf = !!currentUser && emails.includes(currentUser.email);

  // Anyone in the list who has since paused. Reported upward so the form can
  // refuse to submit, and named below so the fix ("take them out") is
  // obvious rather than something to deduce from a rejected submission.
  const pausedSelected = selectedFriends.filter((f) => f.paused);
  useEffect(() => {
    onPausedSelectionChange?.(pausedSelected.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pausedSelected.length]);

  return (
    <div>
      <div className="relative">
        <div className="rounded-lg border border-line px-3 py-2">
          <div className="flex flex-wrap gap-1.5">
            {includesSelf && currentUser && (
              <span className="flex items-center gap-1.5 rounded-full bg-amber/10 px-2.5 py-1 text-xs text-amber">
                <Avatar image={currentUser.image} name={displayName(currentUser)} size={16} />
                Me{currentUser.name ? ` (${currentUser.name})` : ""}
                <button type="button" onClick={() => onChange(emails.filter((e) => e !== currentUser.email))} aria-label="Remove yourself">
                  ×
                </button>
              </span>
            )}
            {selectedFriends.map((f) => (
              // A paused chip drops the teal and says so, rather than sitting
              // there looking like every other guest until the form refuses to
              // submit. The × stays live in both states -- this chip is the
              // thing that has to be removed to get moving again, so it would
              // be a poor moment to take away the control that does it.
              <span
                key={f.email}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
                  f.paused ? "bg-ink/5 text-ink/40" : "bg-teal/10 text-teal"
                }`}
              >
                <span className={f.paused ? "opacity-50" : undefined}>
                  <Avatar image={f.image} name={displayName(f)} colorKey={f.id} size={16} />
                </span>
                {displayName(f)}
                {f.paused && <span className="text-ink/30">· {PAUSED_TAG}</span>}
                <button type="button" onClick={() => onChange(emails.filter((e) => e !== f.email))} aria-label={`Remove ${displayName(f)}`}>
                  ×
                </button>
              </span>
            ))}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              placeholder={selectedFriends.length === 0 && !includesSelf ? "Search your friends…" : "Add another…"}
              className="min-w-[10ch] flex-1 py-1 text-sm outline-none"
            />
          </div>
        </div>

        {open && filtered.length > 0 && (
          <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-auto rounded-lg border border-line bg-white text-sm shadow-sm">
            {filtered.map((f) => (
              <li key={f.email}>
                {/* Paused friends stay listed and go grey rather than
                    disappearing. Dropping them from the list would read as
                    "we've lost them" -- someone would search, find nothing,
                    and go looking for a bug (or for the friend). Greyed and
                    labelled answers the question on the spot. */}
                <button
                  type="button"
                  disabled={f.paused}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addFriend(f.email!);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink/80 hover:bg-paper disabled:cursor-not-allowed disabled:text-ink/30 disabled:hover:bg-transparent"
                >
                  <span className={f.paused ? "opacity-40" : undefined}>
                    <Avatar image={f.image} name={displayName(f)} colorKey={f.id} size={20} />
                  </span>
                  <span>{displayName(f)}</span>
                  {f.paused && <span className="ml-auto text-xs text-ink/30">{PAUSED_TAG}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {query.trim().length > 0 && (
        <p className="mt-1.5 text-xs text-amber">
          Not added yet — pick a match from the list, or clear this text to continue.
        </p>
      )}

      {/* Same amber as the warning above, since it's the same kind of thing:
          a specific reason this form can't be submitted yet, with the fix
          named in the sentence. */}
      {pausedSelected.length > 0 && (
        <p className="mt-1.5 text-xs text-amber">
          {pausedInviteeMessage(pausedSelected.map(displayName))} Remove{" "}
          {pausedSelected.length === 1 ? "them" : "them all"} to continue.
        </p>
      )}

      {friends !== null && friends.length === 0 && (
        <p className="mt-1.5 text-xs text-ink/40">
          You don't have any friends on Venndra yet.{" "}
          <Link href="/friends/new" className="text-amber hover:underline">
            Add one
          </Link>{" "}
          to invite them here.
        </p>
      )}
    </div>
  );
}