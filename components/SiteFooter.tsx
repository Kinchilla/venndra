import { feedbackConfigured } from "../lib/feedback";
import FeedbackDialog from "./FeedbackDialog";

/**
 * The site-wide footer.
 *
 * Deliberately thin -- one link, and only the one. The header already carries
 * navigation, so a footer repeating it would be a second place to keep in sync
 * for no gain. This exists to hold the feedback link (issue #15) and can grow
 * later if there's something that genuinely belongs at the bottom of a page.
 *
 * mt-auto with the body's min-h-screen would pin it to the bottom of short
 * pages, but the body isn't a flex column and making it one would put every
 * existing page's layout at risk for a cosmetic gain on the two pages short
 * enough to notice. It simply follows the content instead.
 */
export default function SiteFooter() {
  if (!feedbackConfigured()) return null;

  return (
    <footer className="mt-16 border-t border-line/60">
      {/*
        A column rather than a row even with one child in it, so that whatever
        lands here next stacks instead of crowding the link -- it's ~45
        characters and needs the width to wrap onto a second line on a narrow
        phone. Truncating the parenthetical away would defeat the point of
        having written it.

        Centring is done with text-align on the child rather than
        `items-center` here. `items-center` sizes a flex item to its content,
        which would let the label push past a 320px viewport instead of
        wrapping inside it; the default `stretch` keeps the child full-width so
        the wrap still happens, and the text centres within it.
      */}
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-6 py-8">
        <FeedbackDialog />
      </div>
    </footer>
  );
}
