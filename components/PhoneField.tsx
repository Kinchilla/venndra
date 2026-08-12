"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "../lib/buttonStyles";
import Button from "./Button";
import { COUNTRIES, DEFAULT_COUNTRY, findCountry, flagEmoji, formatNational, nationalDigits, parsePhone } from "../lib/phone";

/**
 * The phone number field in Settings → Profile.
 *
 * Three states, not one, because a number here is a claim that has to be
 * proven before it does anything:
 *
 *   editing   country dropdown + the input, on the way to a text being sent
 *   pending   saved, texted, waiting for the link to be opened
 *   verified  proven, and doing its job
 *
 * Rendered inside ProfileForm's card but NOT inside its <form> element -- a
 * nested form is invalid HTML, and more to the point saving a number is a
 * different act from saving a name. Pressing Save on the profile shouldn't
 * send a text, so this owns its own buttons and its own submit.
 */
export default function PhoneField({
  initialPhone,
  initialCountry,
  initialVerified,
  /** False when the deployment has no SMS credentials -- see lib/sms.smsConfigured. */
  canSend,
}: {
  initialPhone: string | null;
  initialCountry: string | null;
  initialVerified: boolean;
  canSend: boolean;
}) {
  const router = useRouter();

  const [country, setCountry] = useState(initialCountry ?? DEFAULT_COUNTRY);
  // Seeded from the stored E.164 in its display shape, so reopening Settings
  // shows "(555) 123-4567" rather than the "+15551234567" that's on disk.
  const [input, setInput] = useState(
    initialPhone ? formatNational(nationalDigits(initialPhone, initialCountry ?? DEFAULT_COUNTRY), initialCountry ?? DEFAULT_COUNTRY) : ""
  );

  /**
   * The number as it actually stands on the account, kept apart from the
   * `country`/`input` the form is editing.
   *
   * Two copies rather than one because the field is the only thing that knows
   * what "cancel" means. With a single copy, typing in the box WAS the change:
   * backing out left the edits on screen next to a "Verified" badge that
   * belonged to the old number, which is the worst of both -- it reads as
   * though something unconfirmed had been confirmed. This is what the
   * non-editing view renders and what cancel restores to.
   */
  const [saved, setSaved] = useState<{ verified: boolean; input: string; country: string } | null>(
    initialPhone
      ? {
          verified: initialVerified,
          input: formatNational(
            nationalDigits(initialPhone, initialCountry ?? DEFAULT_COUNTRY),
            initialCountry ?? DEFAULT_COUNTRY
          ),
          country: initialCountry ?? DEFAULT_COUNTRY,
        }
      : null
  );
  const [editing, setEditing] = useState(!initialPhone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function onCountryChange(iso: string) {
    setCountry(iso);
    // Re-run the formatter against the new country: switching US → France has
    // to drop the parentheses the digits were wearing, or the field shows a
    // shape that country never uses.
    setInput(formatNational(input.replace(/\D/g, ""), iso));
  }

  function onInputChange(value: string) {
    setInput(formatNational(value.replace(/\D/g, ""), country));
    setError(null);
  }

  async function save() {
    // Checked here as well as server-side so a mistyped number is caught
    // before it costs a message, using the same function the route uses.
    const parsed = parsePhone(input, country);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    const res = await fetch("/api/me/phone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: input, country }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(typeof body.error === "string" ? body.error : "Couldn't save that number.");
      return;
    }

    // The edits become the committed value only now that the server took them.
    setSaved({ verified: !!body.verified, input, country });
    setEditing(false);
    if (body.sent) setNotice("Check your texts for a link to confirm this number.");
    router.refresh();
  }

  async function resend() {
    setBusy(true);
    setError(null);
    setNotice(null);

    const res = await fetch("/api/me/phone", { method: "PUT" });
    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(typeof body.error === "string" ? body.error : "Couldn't send another text.");
      return;
    }
    setNotice("Sent — check your texts.");
  }

  /**
   * Asked before Remove runs.
   *
   * Two texts, because the two states lose different things. Removing a
   * verified number throws away a proof that cost a round trip to re-earn;
   * removing a pending one mainly kills a link that's already been texted, and
   * saying so is what stops someone opening it afterwards and wondering why it
   * no longer works.
   */
  function removeConfirmText() {
    if (saved?.verified) {
      return (
        `Remove ${findCountry(saved.country)?.dial ? `+${findCountry(saved.country)?.dial} ` : ""}${saved.input}?\n\n` +
        "Friends will no longer be able to find you by this number. You can add it again later, but you'll have to confirm it by text a second time."
      );
    }
    return (
      `Remove ${saved ? `+${findCountry(saved.country)?.dial} ${saved.input}` : "this number"}?\n\n` +
      "It was never confirmed, so nothing is using it yet. The link already texted to it will stop working."
    );
  }

  async function remove() {
    setBusy(true);
    setError(null);
    setNotice(null);

    const res = await fetch("/api/me/phone", { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError("Couldn't remove that number.");
      return;
    }

    setSaved(null);
    setInput("");
    setEditing(true);
    router.refresh();
  }

  return (
    <div className="mt-4 text-sm">
      <span className="mb-1 block text-ink/60">Phone number</span>

      {editing ? (
        <div className="flex flex-wrap items-center gap-2">
          {/*
            The collapsed control shows only the flag and dial code; the open
            list shows the country name too. A native <select> can't say two
            different things, since what it displays when closed IS the
            selected <option>. So the option keeps the full text, and the
            closed state is covered by an opaque span painting the short form
            over it.

            COVERED, not made transparent. Colouring the select's text away
            takes the dropdown arrow with it -- Chrome draws that arrow in the
            element's `color`, so `text-transparent` leaves a control with no
            visible affordance that it opens. An opaque patch hides the text
            without touching `color`, so the arrow is still drawn, and it stops
            short of the right edge to leave the arrow uncovered.

            Done this way rather than by rewriting the option text on open and
            restoring it on close -- that needs an "is the popup showing"
            signal the platform doesn't give you, and guessing at it with
            focus/mousedown leaves the wrong text on screen whenever the guess
            is wrong. Nothing here depends on timing.

            The alternative, a custom div listbox, would also work and would
            cost the keyboard handling, screen-reader semantics and native
            mobile picker that this keeps for free.
          */}
          {/* Width is the widest face this can ever show -- a flag plus a
              three-digit code, "🇨🇷 +506" -- plus the arrow's 1.25rem and the
              padding, and nothing more. Measured rather than guessed: at
              5.5rem the longest code overflowed its cover by a single pixel. */}
          <div className="relative w-[5.75rem] shrink-0">
            <select
              value={country}
              onChange={(e) => onCountryChange(e.target.value)}
              aria-label="Country"
              // font-flags supplies the flag glyphs Windows lacks -- see the
              // @font-face note in globals.css. Options inherit it from here.
              // bg-white stated explicitly so the cover below can match it.
              className="font-flags w-full rounded-lg border border-line bg-white px-2 py-2"
            >
              {COUNTRIES.map((c) => (
                <option key={c.iso} value={c.iso}>
                  {flagEmoji(c.iso)} +{c.dial} {c.name}
                </option>
              ))}
            </select>

            {/* aria-hidden and non-interactive: purely the closed control's
                face. The select underneath remains the real widget and still
                announces the full country name to a screen reader.

                Inset by a pixel top/bottom/left so it covers the text without
                painting over the select's own border, and stopped 1.25rem from
                the right so the arrow stays visible. */}
            <span
              aria-hidden
              className="font-flags pointer-events-none absolute inset-y-px left-px right-5 flex items-center rounded-l-lg bg-white px-2 text-sm"
            >
              {flagEmoji(country)} +{findCountry(country)?.dial}
            </span>
          </div>
          <input
            type="tel"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            // Enter submits, as it would in a real form -- this isn't one (see
            // the note at the top), so the behaviour has to be spelled out.
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              }
            }}
            placeholder={country === "US" || country === "CA" ? "(555) 123-4567" : "Phone number"}
            // Sized to its longest realistic content rather than stretched to
            // the card: a phone number is a fixed-width thing, and a full-width
            // box for fourteen characters left the save button stranded on a
            // row of its own. Fixed rather than flex-1 so the button's position
            // doesn't shift as the country changes.
            className="w-44 shrink-0 rounded-lg border border-line px-3 py-2"
          />

          {/* Sits immediately after the input rather than being pushed to the
              card's right edge -- the buttons act on the field, so they read as
              attached to it instead of floating at the end of the line. */}
          <div className="flex items-center gap-2">
            <button type="button" onClick={save} disabled={busy} className={buttonClass({ variant: "neutral", size: "sm" })}>
              {busy ? "Saving…" : saved ? "Save new number" : "Save and send code"}
            </button>
            {saved && (
              <button
                type="button"
                onClick={() => {
                  // Throw the edits away and put the committed number back.
                  // Leaving them on screen would show an unconfirmed number
                  // sitting under the badge earned by the old one.
                  setCountry(saved.country);
                  setInput(saved.input);
                  setEditing(false);
                  setError(null);
                }}
                disabled={busy}
                className={buttonClass({ variant: "quiet", size: "sm" })}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {/* Dial code included, because the national part alone is ambiguous
              once the country dropdown is no longer on screen -- "612345678"
              says nothing about which country's number it is. */}
          {/* Reads the committed value, not the in-progress edits -- this row
              is a statement about the account, so it must never show something
              that was typed and then abandoned. */}
          <span className="rounded-lg border border-line px-3 py-2 text-ink/80">
            +{findCountry(saved?.country ?? country)?.dial} {saved?.input ?? input}
          </span>
          {/* Status sits between the number and the buttons: it describes the
              number, so it belongs beside it rather than trailing a row of
              controls it says nothing about. */}
          {saved?.verified ? (
            <span className="text-xs font-medium text-teal">✓ Verified</span>
          ) : (
            <span className="text-xs text-ink/50">Waiting for confirmation</span>
          )}
          {/* Resend before Change: while a number is pending, sending another
              text is the thing most people are here to do -- editing the
              number is the rarer case of having got it wrong. */}
          {!saved?.verified && (
            <button type="button" onClick={resend} disabled={busy} className={buttonClass({ variant: "neutral", size: "sm" })}>
              {busy ? "Sending…" : "Resend link"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={busy}
            className={buttonClass({ variant: "edit", size: "sm" })}
          >
            Change
          </button>
          {/* Via <Button> rather than a bare <button>, so this inherits the
              house rule that destructive actions ask first -- see the note in
              components/Button.tsx about keeping the dialog welded to the red
              styling instead of letting the pairing drift. */}
          <Button variant="danger" size="sm" confirm={removeConfirmText} onClick={remove} disabled={busy}>
            Remove
          </Button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {notice && <p className="mt-2 text-xs text-teal">{notice}</p>}

      {/* The explanatory line the field can't do without. Someone typing their
          phone number into a website is entitled to know what it's for before
          they do it, and "so friends can find you" is both the honest answer
          and the reason to bother. The second sentence isn't decoration
          either -- it's what makes the confirmation text expected rather than
          suspicious when it arrives. */}
      <p className="mt-2 text-xs text-ink/40">
        Optional. Adding your number lets friends who already have it in their contacts find and add you on Venndra —
        it's never shown on your profile. We'll text you a link to confirm it's yours; until you open it, the number
        isn't used for anything.
      </p>

      {!canSend && (
        <p className="mt-2 text-xs text-ink/40">
          Text sending isn't configured on this deployment yet, so numbers can't be confirmed here.
        </p>
      )}
    </div>
  );
}
