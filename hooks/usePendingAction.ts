"use client";

import { useCallback, useEffect, useState, useTransition } from "react";

/**
 * Keeps a button inactive from the click until the change it caused is
 * actually on screen -- not merely until the fetch resolves.
 *
 * Those are two different moments, and the gap between them is real. The
 * handlers this replaces all did the same thing:
 *
 *     setLoading(true);
 *     const res = await fetch(...);
 *     setLoading(null);        // button live again, here
 *     if (res.ok) router.refresh();
 *
 * `router.refresh()` isn't awaited and doesn't return a promise worth
 * awaiting: it asks the server to re-render, and the new tree lands some time
 * later. So for the whole of that round trip the user is looking at a live,
 * clickable button on a row that no longer exists server-side. Pressing it
 * again fires a second DELETE against a row that's already gone.
 *
 * Wrapping the refresh in a transition is what closes the gap -- `isPending`
 * stays true until the refreshed server components have committed, which is
 * exactly the moment the row disappears.
 *
 * The four verbs correspond to the four ways an action can end:
 *
 *   begin(key)      it started; `pending === key` drives the "Removing…" label
 *   release()       it's over and this button should be live again -- a failed
 *                   request, or a success whose result already landed in local
 *                   state during this same render
 *   commit(apply)   it succeeded, and `apply` (a router.refresh(), a push, a
 *                   parent's setState) is what will show that. Runs inside a
 *                   transition and stays disabled until the change commits
 *   hold()          it succeeded and this component is on its way out. Nothing
 *                   re-enables; the unmount ends it
 *
 * `hold()` is deliberately a no-op rather than an omission. Handlers that end
 * this way were already doing it by leaving a comment where the reset would
 * have gone (see AccountManagement's delete, which signs out); naming it means
 * the next reader doesn't have to decide whether a missing reset was intended.
 *
 * Components that never call router.refresh() -- because they drop the row
 * from their own state in the same batch that clears the pending flag -- have
 * no gap to close and don't need this. ConnectedAccountsSection and
 * PhoneVerifyButton are already correct on those grounds.
 */
export function usePendingAction<K extends string = string>() {
  const [pending, setPending] = useState<K | null>(null);
  const [isCommitting, startTransition] = useTransition();
  // A state flag rather than a ref, so the effect below is guaranteed to run
  // after a commit. If it keyed on `isCommitting` alone it would never fire
  // for a transition that finished without ever reporting itself pending, and
  // the button would stay disabled for good.
  const [committed, setCommitted] = useState(false);

  useEffect(() => {
    if (!committed || isCommitting) return;
    setCommitted(false);
    setPending(null);
  }, [committed, isCommitting]);

  const begin = useCallback((key: K) => {
    setCommitted(false);
    setPending(key);
  }, []);

  const release = useCallback(() => {
    setCommitted(false);
    setPending(null);
  }, []);

  const commit = useCallback((apply: () => void) => {
    setCommitted(true);
    startTransition(apply);
  }, []);

  const hold = useCallback(() => {}, []);

  return {
    /** Which action is in flight, for the label. */
    pending,
    /** Anything in flight, or its result still committing -- what `disabled` wants. */
    busy: pending !== null || isCommitting,
    begin,
    release,
    commit,
    hold,
  };
}
