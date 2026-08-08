"use client";

import { ReactNode } from "react";

/**
 * Sliding pill switch, for settings that reveal or hide something rather than
 * just recording a value -- where a checkbox reads as "tick this box" but the
 * control is really "turn this on".
 *
 * Built on a real <input type="checkbox">, kept visually hidden rather than
 * replaced: that keeps keyboard focus, Space to toggle, form semantics and
 * screen-reader announcement working for free, which a <div onClick> would all
 * have to reimplement. The two spans after it are painted from the input's
 * state via Tailwind's `peer-checked:`, so the visual and the real control can
 * never disagree.
 *
 * The knob's easing is a slight overshoot (cubic-bezier(.54, 1.6, .5, 1)) --
 * it travels past its resting point and settles back, which is what makes the
 * movement read as a physical switch being thrown rather than a box being
 * ticked. The track's colour change is deliberately faster than the knob's
 * travel, so the "on" state registers before the knob finishes arriving.
 */
export default function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
  labelPosition = "before",
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Rendered beside the switch and wired up as its accessible name. Omit it only if you pass aria-label instead. */
  label?: ReactNode;
  /** Which side the label sits on. Purely presentational -- it stays inside the same <label>, so it's clickable either way. */
  labelPosition?: "before" | "after";
  "aria-label"?: string;
}) {
  return (
    <label
      className={`inline-flex items-center gap-2 ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
    >
      {labelPosition === "before" && label}
      {/*
        44x24 rather than the source CSS's 50x30. That was built as a standalone
        mobile control with nothing beside it; here the switch always sits next
        to text-sm, whose line box is 20px, and at 30px it towered over its own
        label at 1.5x its height. 24px lands at 1.2x -- still visibly the more
        prominent half of the pair, which is the point of a switch, without the
        mismatch. (22px was tried first and reads as merely text-sized at 1.1x.)
      */}
      <span className="relative inline-flex h-[24px] w-[44px] shrink-0 items-center">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          aria-label={ariaLabel}
          onChange={(e) => onChange(e.target.checked)}
        />
        {/* Track */}
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full border border-line bg-white transition-colors duration-200 peer-checked:border-amber peer-checked:bg-amber peer-focus-visible:ring-2 peer-focus-visible:ring-amber/40 peer-focus-visible:ring-offset-1"
        />
        {/* Knob */}
        <span
          aria-hidden="true"
          // Shadow offsets scaled with the knob (28px -> 18px). Kept at the
          // source's 4px they read as a drop shadow belonging to a bigger
          // object, which looks heavy and slightly detached at this size.
          className="pointer-events-none absolute left-[2px] h-[20px] w-[20px] rounded-full bg-[whitesmoke] shadow-[0_0_0_1px_hsla(0,0%,0%,0.1),0_2px_0_0_hsla(0,0%,0%,0.04),0_2px_6px_hsla(0,0%,0%,0.13),0_2px_2px_hsla(0,0%,0%,0.05)] transition-transform duration-[350ms] ease-[cubic-bezier(.54,1.6,.5,1)] peer-checked:translate-x-[20px]"
        />
      </span>
      {labelPosition === "after" && label}
    </label>
  );
}
