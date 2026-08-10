// Google sign-in hands us a picture; a magic-link sign-in doesn't, so the
// no-image case is the normal case for a chunk of accounts rather than an
// edge case. Falling back to initials keeps that slot looking deliberate
// instead of like an image that failed to load.

// Keyed by pixel size rather than t-shirt names: the callers are spread across
// chips, pickers and the header at five different sizes, and "which one is md"
// stops being answerable at that point.
const sizes = {
  16: "h-4 w-4 text-[8px]",
  20: "h-5 w-5 text-[9px]",
  24: "h-6 w-6 text-[10px]",
  32: "h-8 w-8 text-xs",
  56: "h-14 w-14 text-xl",
};

export function initialsFor(name: string | null | undefined, email: string | null | undefined) {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    // First and last word, so "Ada Byron King" reads AK rather than AB.
    const letters = words.length === 1 ? words[0][0] : words[0][0] + words[words.length - 1][0];
    return letters.toUpperCase();
  }
  return (email ?? "").trim()[0]?.toUpperCase() ?? "";
}

export default function Avatar({
  image,
  name,
  email,
  size = 24,
}: {
  image: string | null | undefined;
  name: string | null | undefined;
  email: string | null | undefined;
  size?: keyof typeof sizes;
}) {
  // shrink-0 matters: the avatar always sits in a flex row next to text that
  // wants more room than it has, and without it the circle gets squeezed into
  // an oval as the label grows.
  const shape = `${sizes[size]} shrink-0 rounded-full`;

  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt="" referrerPolicy="no-referrer" className={`${shape} object-cover`} />;
  }

  return (
    <span
      aria-hidden="true"
      className={`${shape} inline-flex items-center justify-center bg-line font-medium leading-none text-ink/60`}
    >
      {initialsFor(name, email)}
    </span>
  );
}
