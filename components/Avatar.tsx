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

// Tints of the site palette rather than arbitrary hues: amber and teal are
// Venndra's own two accents, and the other four are picked to sit at roughly
// the same lightness so no one person's avatar shouts louder than the rest of
// the list. Every pair clears 4.5:1, which matters more here than usual --
// initials render as small as 8px in the FriendPicker chips.
//
// These class names have to stay written out in full. Tailwind generates only
// what it can literally see in a scanned file, so building them up (`bg-[${…}]`)
// silently produces circles with no background at all.
const tints = [
  "bg-[#F2D8B0] text-[#74480F]", // amber
  "bg-[#C6D7DF] text-[#234655]", // teal
  "bg-[#F0CDBE] text-[#7F3E2A]", // clay
  "bg-[#D2DDC5] text-[#47593A]", // sage
  "bg-[#E4D2DC] text-[#6B4157]", // plum
  "bg-[#D3D8E6] text-[#414A6B]", // slate
];

/**
 * Keyed on the email rather than the name, for two reasons: the same person
 * keeps the same colour everywhere they appear even where one view has their
 * name and another only has the address, and editing your name on /settings
 * doesn't make the circle change colour under you mid-keystroke.
 *
 * djb2, and deliberately not something like a random pick memoised per render:
 * the header is a server component and the chips are client ones, so the same
 * user gets hashed on both sides of the wire and the two answers have to agree
 * or React reports a hydration mismatch.
 */
function tintFor(key: string) {
  let hash = 5381;
  for (let i = 0; i < key.length; i++) hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0;
  return tints[Math.abs(hash) % tints.length];
}

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

  // An account with neither an email nor a name has no initial to show and
  // nothing stable to hash, so it keeps the old neutral circle -- a coloured
  // one would imply an identity that isn't there.
  const key = (email ?? name ?? "").trim().toLowerCase();
  const tint = key ? tintFor(key) : "bg-line text-ink/60";

  return (
    <span
      aria-hidden="true"
      className={`${shape} ${tint} inline-flex items-center justify-center font-medium leading-none`}
    >
      {initialsFor(name, email)}
    </span>
  );
}
