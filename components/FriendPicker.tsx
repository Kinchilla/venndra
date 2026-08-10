"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Avatar from "./Avatar";

type Friend = { id: string; name: string | null; email: string | null; image: string | null };
type CurrentUser = { email: string; name: string | null; image: string | null };

export default function FriendPicker({
  emails,
  onChange,
  currentUser,
  onPendingTextChange,
}: {
  emails: string[];
  onChange: (emails: string[]) => void;
  currentUser?: CurrentUser | null;
  onPendingTextChange?: (hasPendingText: boolean) => void;
}) {
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/friends")
      .then((r) => r.json())
      .then((d) => setFriends((d.friends ?? []).map((f: any) => f.user)));
  }, []);

  useEffect(() => {
    onPendingTextChange?.(query.trim().length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const available = useMemo(() => (friends ?? []).filter((f) => f.email && !emails.includes(f.email)), [friends, emails]);
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

  return (
    <div>
      <div className="relative">
        <div className="rounded-lg border border-line px-3 py-2">
          <div className="flex flex-wrap gap-1.5">
            {includesSelf && currentUser && (
              <span className="flex items-center gap-1.5 rounded-full bg-amber/10 px-2.5 py-1 text-xs text-amber">
                <Avatar image={currentUser.image} name={currentUser.name} email={currentUser.email} size={16} />
                Me{currentUser.name ? ` (${currentUser.name})` : ""}
                <button type="button" onClick={() => onChange(emails.filter((e) => e !== currentUser.email))} aria-label="Remove yourself">
                  ×
                </button>
              </span>
            )}
            {selectedFriends.map((f) => (
              <span key={f.email} className="flex items-center gap-1.5 rounded-full bg-teal/10 px-2.5 py-1 text-xs text-teal">
                <Avatar image={f.image} name={f.name} email={f.email} size={16} />
                {f.name ?? f.email}
                <button type="button" onClick={() => onChange(emails.filter((e) => e !== f.email))} aria-label={`Remove ${f.name ?? f.email}`}>
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
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addFriend(f.email!);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink/80 hover:bg-paper"
                >
                  <Avatar image={f.image} name={f.name} email={f.email} size={20} />
                  <span>{f.name ?? f.email}</span>
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