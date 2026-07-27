"use client";

import { useEffect, useState } from "react";
import SuggestedFriendChip from "./SuggestedFriendChip";

type SuggestedUser = { id: string; name: string | null; email: string | null; image: string | null };

export default function SuggestedFriendsSection() {
  const [suggestions, setSuggestions] = useState<SuggestedUser[] | null>(null);

  useEffect(() => {
    fetch("/api/friends/suggestions")
      .then((r) => r.json())
      .then((d) => setSuggestions(d.suggestions ?? []));
  }, []);

  function removeSuggestion(userId: string) {
    setSuggestions((prev) => (prev ? prev.filter((u) => u.id !== userId) : prev));
  }

  if (suggestions === null || suggestions.length === 0) return null;

  return (
    <div className="mt-8">
      <p className="font-display text-lg font-semibold mb-2">Suggested friends</p>
      <div className="grid gap-2">
        {suggestions.map((u) => (
          <SuggestedFriendChip key={u.id} user={u} onGone={removeSuggestion} />
        ))}
      </div>
    </div>
  );
}