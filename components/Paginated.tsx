"use client";

import { Children, useState, type ReactNode } from "react";

/**
 * Pages a section's chips, and stays out of the way until it's needed.
 *
 * Below the page size there are no controls at all -- a pager under three
 * friends is noise, and the sections here are usually short. It only appears
 * once a section actually overflows.
 *
 * Takes children rather than a data array so the server components that own
 * these lists keep owning them: each page renders whatever chip that section
 * already renders, with no prop shape for this component to know about.
 */
export default function Paginated({ children, pageSize = 5 }: { children: ReactNode; pageSize?: number }) {
  const items = Children.toArray(children);
  const [page, setPage] = useState(0);

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  // Items vanish underneath us all the time -- a chip is deleted, the server
  // re-renders the section with fewer children, and the page we were on may no
  // longer exist. Clamp during render rather than in an effect, so there's
  // never a frame of empty list before the correction lands.
  const current = Math.min(page, pageCount - 1);

  if (items.length <= pageSize) return <>{items}</>;

  const start = current * pageSize;

  return (
    <>
      {items.slice(start, start + pageSize)}
      <div className="mt-1 flex items-center gap-1 text-sm text-ink/50">
        <button
          type="button"
          onClick={() => setPage(current - 1)}
          disabled={current === 0}
          aria-label="Previous page"
          className="rounded-full px-2 py-0.5 transition enabled:hover:text-ink disabled:opacity-30"
        >
          ‹
        </button>
        <span className="tabular-nums">
          {current + 1} of {pageCount}
        </span>
        <button
          type="button"
          onClick={() => setPage(current + 1)}
          disabled={current === pageCount - 1}
          aria-label="Next page"
          className="rounded-full px-2 py-0.5 transition enabled:hover:text-ink disabled:opacity-30"
        >
          ›
        </button>
      </div>
    </>
  );
}
