"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SuggestedFriendChip from "./SuggestedFriendChip";

type SuggestedUser = { id: string; name: string | null; email: string | null; image: string | null };

// A chip that has been acted on fades, then its row collapses (see the
// .suggestion-row rules in globals.css). The unmount is driven by the row's
// transitionend rather than a timer, so that `prefers-reduced-motion` -- which
// collapses every duration to ~0 -- removes the chip immediately instead of
// leaving it sitting there for the length of an animation that never ran.
// These are only backstops for an end event that never arrives, e.g. the
// animation being interrupted or the tab backgrounded partway through, so they
// sit comfortably above the durations in the stylesheet (300ms + 240ms to
// leave, 320ms to enter) rather than racing them.
const LEAVE_FALLBACK_MS = 900;
const ENTER_FALLBACK_MS = 600;

// How long the list takes to settle to its natural height once a swap is over,
// in step with the `transition: height` on .suggestion-list.
const RELEASE_MS = 240;

type State = {
  items: SuggestedUser[] | null;
  leaving: Set<string>;
  entering: Set<string>;
  // Replacements already fetched but deliberately not shown yet -- see endLeave.
  pending: SuggestedUser[];
};

const EMPTY: State = { items: null, leaving: new Set(), entering: new Set(), pending: [] };

export default function SuggestedFriendsSection() {
  const [state, setState] = useState<State>(EMPTY);

  // The list is pinned to its current pixel height for the length of a swap.
  // Without this the page briefly loses the height of the departing chip before
  // the replacement grows back into it, and anyone scrolled near the bottom
  // gets their scroll position clamped and then restored -- the list appears to
  // bounce, even though nothing inside it moved unexpectedly.
  const listRef = useRef<HTMLDivElement | null>(null);
  const [lockedHeight, setLockedHeight] = useState<number | null>(null);
  const releasingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/friends/suggestions")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setState((s) => ({ ...s, items: d.suggestions ?? [] }));
      })
      .catch(() => {
        if (!cancelled) setState((s) => ({ ...s, items: [] }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Pull a fresh list to backfill the gap the departing chip leaves. Refetching
  // beats keeping a local queue of spares: whoever comes next is decided by the
  // server at the moment we ask, so a candidate who stopped being eligible
  // (they friended you in another tab, say) is never rendered. The person just
  // acted on is already excluded server-side -- Dismiss wrote a
  // DismissedSuggestion row, Send Request wrote a PENDING friendship.
  const refill = useCallback(async () => {
    let fresh: SuggestedUser[];
    try {
      const res = await fetch("/api/friends/suggestions");
      if (!res.ok) return;
      fresh = (await res.json()).suggestions ?? [];
    } catch {
      return; // a failed backfill just leaves a shorter list; nothing to undo
    }
    setState((s) => {
      if (!s.items) return s;
      // Everyone already on screen keeps their slot -- only genuinely new
      // people are appended. Re-ordering the survivors to match the server
      // would visibly reshuffle the chips the user is currently looking at.
      const known = new Set([...s.items.map((u) => u.id), ...s.pending.map((u) => u.id)]);
      const added = fresh.filter((u) => !known.has(u.id));
      if (added.length === 0) return s;
      // This usually resolves while the departing row is still animating, so
      // the replacement waits its turn instead of growing into the list while
      // something else is collapsing out of it.
      if (s.leaving.size > 0) return { ...s, pending: [...s.pending, ...added] };
      const entering = new Set(s.entering);
      for (const u of added) entering.add(u.id);
      return { ...s, items: [...s.items, ...added], entering };
    });
  }, []);

  // The chip reports success; the row is what decides when it actually goes.
  const beginLeave = useCallback(
    (userId: string) => {
      // Pin the height before anything starts shrinking, so the measurement is
      // of the intact list.
      const el = listRef.current;
      if (el) {
        releasingRef.current = false;
        setLockedHeight(el.getBoundingClientRect().height);
      }
      setState((s) => (s.leaving.has(userId) ? s : { ...s, leaving: new Set(s.leaving).add(userId) }));
      // Started now rather than after the animation so the replacement has
      // arrived by the time the row finishes collapsing.
      void refill();
    },
    [refill]
  );

  const endLeave = useCallback((userId: string) => {
    setState((s) => {
      if (!s.leaving.has(userId)) return s;
      const leaving = new Set(s.leaving);
      leaving.delete(userId);
      const entering = new Set(s.entering);
      entering.delete(userId);
      const items = (s.items ?? []).filter((u) => u.id !== userId);
      // Held replacements are released only once nothing is still on its way
      // out, so the list finishes closing the old gap before it opens a new
      // one. Two rows resizing at once is what made this look jerky.
      if (leaving.size === 0 && s.pending.length > 0) {
        for (const u of s.pending) entering.add(u.id);
        return { items: [...items, ...s.pending], leaving, entering, pending: [] };
      }
      return { ...s, items, leaving, entering };
    });
  }, []);

  const endEnter = useCallback((userId: string) => {
    setState((s) => {
      if (!s.entering.has(userId)) return s;
      const entering = new Set(s.entering);
      entering.delete(userId);
      return { ...s, entering };
    });
  }, []);

  // Hand the height back once nothing is animating. When a replacement arrived
  // the natural height matches what was pinned, so this is invisible. When the
  // pool ran dry there is genuinely less to show, and the list eases down to
  // its new height in one motion instead of dropping and springing back.
  const busy = state.leaving.size > 0 || state.entering.size > 0;
  useEffect(() => {
    if (busy || lockedHeight === null || releasingRef.current) return;
    const el = listRef.current;
    if (!el) return;
    const natural = Array.from(el.children).reduce((sum, c) => sum + c.getBoundingClientRect().height, 0);
    if (Math.abs(natural - lockedHeight) < 1) {
      setLockedHeight(null);
      return;
    }
    releasingRef.current = true;
    setLockedHeight(natural);
    const timer = window.setTimeout(() => {
      releasingRef.current = false;
      setLockedHeight(null);
    }, RELEASE_MS + 60);
    return () => window.clearTimeout(timer);
  }, [busy, lockedHeight]);

  const { items, leaving, entering } = state;
  if (items === null || items.length === 0) return null;

  return (
    <div className="mt-8">
      <p className="font-display text-lg font-semibold mb-2">Suggested friends</p>
      {/* No `gap` here: the spacing is padding inside each row, so that it
          collapses along with a row that is on its way out. */}
      <div
        ref={listRef}
        className="suggestion-list"
        style={lockedHeight !== null ? { height: `${lockedHeight}px` } : undefined}
      >
        {items.map((u) => (
          <SuggestionRow
            key={u.id}
            userId={u.id}
            leaving={leaving.has(u.id)}
            entering={entering.has(u.id)}
            onLeft={endLeave}
            onEntered={endEnter}
          >
            <SuggestedFriendChip user={u} onGone={beginLeave} />
          </SuggestionRow>
        ))}
      </div>
    </div>
  );
}

function SuggestionRow({
  userId,
  leaving,
  entering,
  onLeft,
  onEntered,
  children,
}: {
  userId: string;
  leaving: boolean;
  entering: boolean;
  onLeft: (userId: string) => void;
  onEntered: (userId: string) => void;
  children: React.ReactNode;
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!leaving || !el) return;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onLeft(userId);
    };
    // Only the collapse ends the row -- the opacity transition finishes first,
    // while the chip still occupies its space.
    const onTransitionEnd = (e: TransitionEvent) => {
      if (e.target === el && e.propertyName === "grid-template-rows") finish();
    };
    el.addEventListener("transitionend", onTransitionEnd);
    const timer = window.setTimeout(finish, LEAVE_FALLBACK_MS);
    return () => {
      el.removeEventListener("transitionend", onTransitionEnd);
      window.clearTimeout(timer);
    };
  }, [leaving, el, userId, onLeft]);

  useEffect(() => {
    if (!entering || !el) return;
    // Cleared once it has played: the fade-in keyframe holds opacity via
    // fill-mode, and an animation's filled value outranks a transition, so
    // leaving it applied would stop this chip from ever fading back out.
    const onAnimationEnd = () => onEntered(userId);
    el.addEventListener("animationend", onAnimationEnd);
    const timer = window.setTimeout(onAnimationEnd, ENTER_FALLBACK_MS);
    return () => {
      el.removeEventListener("animationend", onAnimationEnd);
      window.clearTimeout(timer);
    };
  }, [entering, el, userId, onEntered]);

  return (
    <div
      ref={setEl}
      className="suggestion-row"
      data-leaving={leaving ? "true" : undefined}
      data-entering={entering ? "true" : undefined}
    >
      <div className="suggestion-row-inner">
        <div className="suggestion-row-pad">{children}</div>
      </div>
    </div>
  );
}
