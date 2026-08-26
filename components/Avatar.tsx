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
 * Keyed on whatever the caller passes as `colorKey`, which should be the
 * user's id wherever one is known.
 *
 * It used to be the email, so that the same person kept the same colour in a
 * view that had their name and a view that had only their address. Issue #6
 * removed the second kind of view -- most lists no longer receive an email at
 * all -- so keying on it now means the same person hashes differently
 * depending on which page you're looking at. An id is what the email was
 * standing in for: stable, present everywhere, and unlike a name it doesn't
 * change colour under you mid-keystroke while you edit it on /settings.
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

/**
 * Initials for an already-resolved display string -- the output of
 * lib/displayName, not a raw `User.name`. That matters for the accounts that
 * have no name: what they're shown as is their email address, so what this
 * gets handed is an address and the first letter of it is the right initial.
 * Working that out here would mean re-deciding, in a second place, the
 * question lib/displayName exists to answer once.
 */
export function initialsFor(label: string | null | undefined) {
  const words = (label ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  // First and last word, so "Ada Byron King" reads AK rather than AB.
  const letters = words.length === 1 ? words[0][0] : words[0][0] + words[words.length - 1][0];
  return letters.toUpperCase();
}

export default function Avatar({
  image,
  name,
  colorKey,
  size = 24,
}: {
  image: string | null | undefined;
  /** Already resolved through lib/displayName -- see initialsFor above. */
  name: string | null | undefined;
  /** Stable per-person hash input; the user's id where there is one. */
  colorKey?: string | null | undefined;
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

  // An account with nothing to hash and no label keeps the old neutral circle
  // -- a coloured one would imply an identity that isn't there.
  const key = (colorKey ?? name ?? "").trim().toLowerCase();
  const tint = key ? tintFor(key) : "bg-line text-ink/60";

  return (
    <span
      aria-hidden="true"
      className={`${shape} ${tint} inline-flex items-center justify-center font-medium leading-none`}
    >
      {initialsFor(name)}
    </span>
  );
}
