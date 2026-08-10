/**
 * The little amber pill that says "there are N things here waiting on you".
 *
 * Shared rather than copied because its whole job is recognition: the badge on
 * the Events nav item and the one beside "Still deciding" have to read as the
 * same object, or the section stops explaining what the header was counting.
 * That means the same size in both places too -- it's one UI element, not a
 * shape that scales with whatever text it sits next to.
 *
 * Renders nothing at zero, so callers can pass a raw count without guarding.
 *
 * `font-sans` is load-bearing, not decoration: font-family inherits, and one of
 * the two call sites is a <span> inside an <h2>, which globals.css puts in
 * Fraunces. Without pinning it the same badge renders serif digits beside the
 * heading and sans digits in the header -- which is exactly the tell that they
 * aren't the same object.
 *
 * Deliberately NOT "use client" -- SiteHeader renders this during a server
 * render (see lib/buttonStyles.ts for the same constraint).
 */
export default function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;

  return (
    <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber px-1 font-sans text-[10px] font-bold leading-none text-white">
      {count}
    </span>
  );
}
