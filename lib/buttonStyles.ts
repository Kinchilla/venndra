/**
 * The site's button vocabulary, in one place.
 *
 * These variants aren't invented here -- they're the patterns already repeated
 * by hand across the app, extracted so that "make this button behave like that
 * one" stops being a conversation. Callers pick an intent; what colour that
 * implies is this file's problem:
 *
 *   primary  solid amber   -- creates or commits something ("New event", "Save")
 *   edit     teal outline   -- edits/redirects an existing thing ("Edit this search")
 *   danger   red outline    -- destroys or detaches ("Cancel this event", "Disconnect")
 *   neutral  plain outline  -- everything else ("Connect iCloud calendar")
 *   quiet    borderless     -- dismissals that shouldn't compete ("Cancel")
 *   nav      borderless     -- header/inline navigation, darker than quiet
 *                              because it's a destination, not a way out
 *
 * Deliberately NOT a "use client" module: server components render plenty of
 * these as <Link>, and every export of a "use client" file becomes a client
 * reference -- calling one during a server render throws. The <Button> wrapper
 * (which needs state for its confirm dialog) lives in components/Button.tsx and
 * imports from here.
 */

export type ButtonVariant = "primary" | "edit" | "danger" | "neutral" | "quiet" | "nav";
export type ButtonSize = "sm" | "nav" | "md" | "lg" | "xl" | "hero";

// Size owns padding AND text size, variant owns colour -- never both, or the
// two halves emit competing utilities (px-4 vs px-6) and which one wins comes
// down to stylesheet order rather than anything readable at the call site.
//
// `nav` sits outside the sm..hero ladder on purpose: it's sm's padding at md's
// text size, which is a shape (a compact pill that still reads as body text),
// not a step in a scale. Naming it for the role avoids pretending there's an
// ordering between it and `sm`.
const SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  nav: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-2.5 text-sm",
  xl: "px-5 py-3 text-sm",
  hero: "px-6 py-3", // inherits its text size, matching the homepage hero pair
};

// Every outline variant fills with the colour it merely hints at on hover, for
// as long as the mouse is held down, then reverts on release. That gives a
// press a visible answer without leaving any lasting mark -- which matters,
// because a button that stays filled is making a claim about STATE, and these
// buttons don't have state. (The saved-group chips previously did stay
// highlighted, and it read as a lie the moment the list they'd filled in was
// edited.) Anything that genuinely is a persistent selection -- the sort-mode
// and 12h/24h segmented controls -- keeps its own styling and shouldn't use
// these variants.
//
// `primary` is already filled, so it darkens instead of filling.
const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-amber font-medium text-white hover:brightness-105 active:brightness-95 disabled:opacity-50",
  edit: "border border-line font-medium text-ink/70 hover:border-teal hover:text-teal active:border-teal active:bg-teal active:text-white disabled:opacity-50",
  danger:
    "border border-line font-medium text-ink/70 hover:border-red-600 hover:text-red-600 active:border-red-600 active:bg-red-600 active:text-white disabled:opacity-50",
  neutral: "border border-line hover:border-ink active:border-ink active:bg-ink active:text-white disabled:opacity-50",
  // Borderless variants get a wash rather than a solid fill -- a full block of
  // colour on a control with no outline reads as much heavier than the others.
  quiet: "text-ink/60 hover:text-ink active:bg-ink/10 active:text-ink disabled:opacity-50",
  nav: "text-ink/70 hover:text-ink active:bg-ink/10 active:text-ink disabled:opacity-50",
};

// `transition` rather than `transition-colors`: primary's hover is
// brightness-105, which is a filter, and transition-colors doesn't cover
// filters -- it would snap instead of easing. `transition` covers colour and
// filter both, which is what the homepage hero button already used by hand.
const BASE = "rounded-full transition";

export function buttonClass({
  variant = "neutral",
  size = "md",
  className = "",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Layout-only extras (mt-3, w-fit, shrink-0, inline-block). Avoid padding and text size here -- that's what `size` is for, and duplicates resolve by stylesheet order rather than call-site order. */
  className?: string;
} = {}) {
  return [BASE, SIZES[size], VARIANTS[variant], className].filter(Boolean).join(" ");
}
