"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass } from "../lib/buttonStyles";

/**
 * The footer's feedback form.
 *
 * A dialog opened in place rather than a page navigated to, and that isn't a
 * styling preference -- it's forced by the screenshot. The thing worth
 * capturing is the page the reporter was looking at when something went wrong,
 * and navigating to /feedback destroys it before the form is even on screen.
 * Opening over the top keeps the subject of the report alive underneath.
 *
 * The link text is the one from issue #15, in full. The parenthetical is what
 * makes it self-explanatory without a click, so the footer wraps it onto two
 * lines on a narrow phone rather than truncating it away.
 */

/** Roughly the point where the base64 body stops fitting comfortably in a serverless request. */
const MAX_SCREENSHOT_BYTES = 1_500_000;

/**
 * How long a capture gets before it's called a failure.
 *
 * A capture normally takes about two seconds, so this is not there to catch
 * slowness. It's there because html-to-image resolves its final step inside a
 * requestAnimationFrame callback, and rAF does not fire in a background tab --
 * so a reporter who ticks the box and switches tabs while it works comes back
 * to a promise that never settled and a checkbox stuck mid-tick, with nothing
 * said. This turns that into a message they can act on.
 */
const CAPTURE_TIMEOUT_MS = 15_000;

type Kind = "bug" | "idea";

/**
 * Reject if `promise` hasn't settled in time.
 *
 * The underlying work isn't cancellable -- it carries on in the background and
 * its result is dropped. That's acceptable here because the only thing it holds
 * is memory, and the alternative is a UI that waits on it forever.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("capture timed out")), ms)),
  ]);
}

/** A neutral grey square, so a masked slot reads as "a photo was here". */
const MASKED_IMAGE =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#D8D2C6"/></svg>');

/**
 * Swap every cross-origin <img> for a placeholder, and hand back the undo.
 *
 * The fallback half of capture()'s two attempts, and deliberately NOT what it
 * does first. Cross-origin images usually inline fine -- Google profile
 * pictures from lh3.googleusercontent.com are served with CORS headers, and a
 * capture that includes them is the more faithful one. This exists because
 * "usually" isn't "always": html-to-image re-requests each image with
 * crossOrigin="anonymous", and if any single one of those fails it rejects the
 * ENTIRE capture. Observed failing with HTTP 429 when the CDN was rate-limiting
 * repeated requests; a slow image or a genuinely CORS-less host would land the
 * same way. One avatar takes the whole screenshot with it.
 *
 * Swapping the src rather than filtering the elements out, because removing an
 * <img> removes its box: the avatars are 24-32px in flex rows, so dropping them
 * slides every name left and produces a screenshot of a layout the reporter
 * never saw. That's the same failure the fonts note above is about. The
 * placeholder keeps the element, its classes and its dimensions, so what's lost
 * is the photo and nothing else.
 *
 * The page visibly flickers while the placeholders are in. Accepted: this only
 * runs on the retry, after a capture has already failed, and the alternative is
 * no screenshot at all.
 */
function maskForeignImages(): () => void {
  const swapped: { img: HTMLImageElement; src: string }[] = [];

  for (const img of Array.from(document.images)) {
    let foreign: boolean;
    try {
      foreign = new URL(img.src, location.href).origin !== location.origin;
    } catch {
      foreign = true; // an unparseable src is one we can't vouch for either
    }
    if (!foreign) continue;
    swapped.push({ img, src: img.src });
    img.src = MASKED_IMAGE;
  }

  // Returned rather than run on a timer, so the caller can put it in a finally
  // and the page can't be left wearing placeholders if the capture throws.
  return () => {
    for (const { img, src } of swapped) img.src = src;
  };
}

export default function FeedbackDialog() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-center text-sm text-ink/60 underline decoration-ink/25 underline-offset-4 transition hover:text-ink hover:decoration-ink/50"
      >
        Submit feedback (feature ideas and bug reports)
      </button>
      {open && <FeedbackModal onClose={() => setOpen(false)} />}
    </>
  );
}

function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<Kind>("bug");
  const [message, setMessage] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [website, setWebsite] = useState(""); // honeypot; see the route's schema
  const [shot, setShot] = useState<string | null>(null);
  // Collapsed by default: a full-page capture is far taller than it is wide, so
  // showing all of it up front would push the Send button off the bottom of the
  // dialog on almost every page.
  const [shotExpanded, setShotExpanded] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /**
   * Rasterize the page behind this dialog.
   *
   * Run when the box is ticked, not when the dialog opens. Capturing up front
   * and discarding it if the box stayed unticked would mean every visitor's
   * screen was rasterized whether or not they agreed to it -- the consent has
   * to gate the capture, not just the upload.
   *
   * The library is a dynamic import for the same reason: it's 300KB serving a
   * checkbox most people will never tick, and there's no case for putting that
   * in the bundle of every page on the site.
   */
  async function capture() {
    setCapturing(true);
    setError(null);
    try {
      const { toJpeg } = await import("html-to-image");
      const attempt = () =>
        withTimeout(
          toJpeg(document.body, {
            // JPEG, not PNG: a full-page capture of a text-heavy app is
            // megabytes as lossless PNG, and the artefacts that costs are
            // invisible at the job this does, which is showing what the screen
            // looked like.
            quality: 0.85,
            // 1, not the device pixel ratio -- a retina phone would otherwise
            // produce a 3x capture, i.e. nine times the pixels, to show the
            // same layout. Layout bugs are legible at 1x.
            pixelRatio: 1,
            // The page's own background. Without it the transparent gaps
            // between elements composite to black, which reads as a rendering
            // bug in the very screenshot meant to demonstrate a different one.
            backgroundColor: "#FAF7F2",
            // Leave this dialog out, or the screenshot is mostly a picture of
            // the form being used to send it.
            filter: (node) => !(node instanceof HTMLElement && node.dataset.feedbackUi !== undefined),
            // Webfonts are deliberately left ON (the library's default),
            // despite costing about 900ms and inflating the intermediate SVG
            // from 460KB to 2.2MB -- it inlines Fraunces and Inter rather than
            // referencing them, because the SVG is rasterized in a context
            // that can't reach the network. Measured, not assumed.
            //
            // Worth paying because a font that isn't embedded doesn't just
            // look wrong, it MEASURES wrong: text falls back to a face with
            // different metrics, so the capture reflows. A screenshot attached
            // to "this wraps badly on my phone" would then show wrapping the
            // reporter never saw. The inflated SVG is transient -- what gets
            // uploaded is the rasterized JPEG, whose size depends on pixels,
            // not on it.
          }),
          CAPTURE_TIMEOUT_MS
        );

      /*
       * Twice, and the order matters.
       *
       * The first attempt leaves the page exactly as it is, because that's the
       * faithful screenshot and it's what normally succeeds -- cross-origin
       * avatars usually inline without complaint. Only if that fails is it
       * worth trading the profile pictures away, since html-to-image rejects
       * the whole capture over a single image it can't fetch (a CDN returning
       * 429, a slow host, one genuinely without CORS headers). Masking first
       * would degrade every screenshot to guard against a case that mostly
       * doesn't happen.
       */
      let dataUrl: string;
      try {
        dataUrl = await attempt();
      } catch {
        const restoreImages = maskForeignImages();
        try {
          dataUrl = await attempt();
        } finally {
          restoreImages();
        }
      }

      // A data URL is ~37% larger than the bytes it carries; this compares the
      // decoded size, which is what actually has to travel.
      const bytes = Math.floor((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
      if (bytes > MAX_SCREENSHOT_BYTES) {
        setShot(null);
        setError("This page rendered too large to attach. You can still send the report without it.");
        return;
      }
      setShot(dataUrl);
    } catch {
      setShot(null);
      setError("Couldn't capture this page. You can still send the report without a screenshot.");
    } finally {
      setCapturing(false);
    }
  }

  async function submit() {
    if (!message.trim()) {
      setError("Tell us what happened first.");
      return;
    }
    setBusy(true);
    setError(null);

    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        message,
        replyTo: replyTo.trim() || "",
        website,
        page: {
          url: window.location.href,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          userAgent: navigator.userAgent,
        },
        screenshot: shot ? shot.slice(shot.indexOf(",") + 1) : null,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      setError(typeof body.error === "string" ? body.error : "Couldn't send that. Try again in a moment.");
      return;
    }
    setSent(true);
  }

  return (
    // data-feedback-ui is what capture()'s filter keys on -- it must stay on
    // the outermost node this component renders, or parts of the dialog end up
    // in the screenshot.
    <div
      data-feedback-ui
      role="dialog"
      aria-modal="true"
      aria-label="Submit feedback"
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-4 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-white p-5 shadow-lg">
        {sent ? (
          <div className="py-4 text-center">
            <p className="font-display text-lg font-semibold">Feedback sent ✓</p>
            <p className="mt-2 text-sm text-ink/60">Thanks for helping us improve Venndra!</p>
            <button type="button" onClick={onClose} className={buttonClass({ variant: "neutral", className: "mt-5" })}>
              Close
            </button>
          </div>
        ) : (
          <>
            <h2 className="font-display text-lg font-semibold">Submit feedback</h2>

            <div className="mt-4 flex gap-2">
              {(
                [
                  ["bug", "Something's broken"],
                  ["idea", "I have an idea"],
                ] as [Kind, string][]
              ).map(([value, label]) => {
                // Each choice answers in the colour the rest of the site already
                // uses for that kind of thing: red is what `danger` means in
                // lib/buttonStyles.ts, so a bug report picks it up, and an idea
                // stays teal. The pair reads as two different errands rather
                // than one control with two positions.
                const selected = kind === value;
                const accent =
                  value === "bug" ? "border-red-600 bg-red-600 text-white" : "border-teal bg-teal text-white";
                const idle =
                  value === "bug"
                    ? "border-line text-ink/70 hover:border-red-600"
                    : "border-line text-ink/70 hover:border-teal";
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setKind(value)}
                    aria-pressed={selected}
                    // A persistent selection, so it keeps its own styling rather
                    // than borrowing a button variant -- see the note in
                    // lib/buttonStyles.ts about variants not carrying state.
                    className={`rounded-full border px-3 py-1.5 text-sm transition ${selected ? accent : idle}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                setError(null);
              }}
              rows={5}
              maxLength={5000}
              placeholder={
                kind === "bug"
                  ? "What were you doing, and what happened instead?"
                  : "What would you like Venndra to do?"
              }
              className="mt-3 w-full rounded-lg border border-line px-3 py-2 text-sm"
            />

            <label className="mt-3 block text-sm">
              <span className="mb-1 block text-ink/60">Your email (optional)</span>
              <input
                type="email"
                value={replyTo}
                onChange={(e) => setReplyTo(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-lg border border-line px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-xs text-ink/40">Only used to reply about this report.</span>
            </label>

            {/* The honeypot. Hidden from people and from screen readers, left
                in the tab order's way with tabIndex -1 so nobody lands on it.
                aria-hidden rather than display:none because some bots skip
                fields that aren't rendered at all. */}
            <div aria-hidden className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0">
              <label>
                Website
                <input
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </label>
            </div>

            <label className="mt-4 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={shot !== null}
                disabled={capturing}
                onChange={(e) => {
                  if (e.target.checked) capture();
                  else {
                    setShot(null);
                    setShotExpanded(false);
                    setError(null);
                  }
                }}
                className="mt-0.5"
              />
              <span>
                Include a screenshot of this page
                {capturing && <span className="text-ink/50"> — capturing…</span>}
              </span>
            </label>

            {/* Shown, not just attached. A checkbox saying a screenshot will be
                sent asks someone to agree to something they can't see; the
                thumbnail is what turns that into a decision. It's also the only
                way they'd notice the capture caught something they'd rather it
                didn't. */}
            {shot && (
              <div className="mt-2">
                {/*
                  A button, not a bare <img> with a click handler: expanding is
                  a real control, and this way it lands in the tab order and
                  answers the keyboard for free.
                */}
                <button
                  type="button"
                  onClick={() => setShotExpanded((v) => !v)}
                  aria-expanded={shotExpanded}
                  className="block w-full overflow-hidden rounded-lg border border-line transition hover:border-teal"
                >
                  <img
                    src={shot}
                    alt="Preview of the screenshot that will be attached"
                    // Expanded scales the whole capture to the dialog's width
                    // rather than scrolling it, so "what am I actually sending"
                    // is answered in one look. Collapsed crops to the top,
                    // which is the part that identifies the page at a glance.
                    className={shotExpanded ? "block w-full" : "block max-h-40 w-full object-cover object-top"}
                  />
                </button>
                <p className="mt-1 text-xs text-ink/40">
                  {shotExpanded
                    ? "The whole page. Tap to shrink."
                    : "Showing the top of the page — tap to see all of it."}
                </p>
              </div>
            )}

            {/* Stated plainly and up front, because it is sent whether or not
                anything here is ticked. Someone reporting a bug is entitled to
                know what rides along with their words before they press send.

                Strictly what's collected, and no reassurance about where it
                ends up. A line promising reports were "never posted publicly"
                used to follow this one, and it backfired: nobody suspects their
                bug report is being published until a form raises the
                possibility in order to deny it. Disclosure is useful because
                the reader can't otherwise know what's attached; the promise was
                answering a question nobody had asked. */}
            <p className="mt-4 text-xs text-ink/40">
              Sent with every report: the page you're on, your browser and screen size, and your account if you're
              signed in.
            </p>

            {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} disabled={busy} className={buttonClass({ variant: "quiet" })}>
                Cancel
              </button>
              <button type="button" onClick={submit} disabled={busy || capturing} className={buttonClass({ variant: "primary" })}>
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
