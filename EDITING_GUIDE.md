# Editing & Maintenance Guide

A practical reference for making changes to Venndra yourself, without
needing to ask Claude for every small tweak. For initial setup (getting
credentials, running it the first time), see `README.md` instead — this
doc assumes that's already done and the app runs locally.

---

## 1. The shape of the project, in one page

```
app/                 every URL route lives here, one folder per page
  page.tsx            → the landing page ("/")
  login/page.tsx       → "/login"
  events/page.tsx      → "/events"
  events/new/page.tsx  → "/events/new" ("Find us a time" form)
  events/[id]/page.tsx → "/events/some-id" (one event's results page)
  friends/page.tsx      → "/friends"
  friends/new/page.tsx  → "/friends/new" (send a friend request)
  groups/new/page.tsx  → "/groups/new"
  groups/[id]/edit/    → "/groups/some-id/edit"
  settings/page.tsx    → "/settings"
  api/                 → backend logic, not visible pages (routes your
                          browser calls behind the scenes)
components/           reusable pieces used across multiple pages
lib/                  core logic: availability math, calendar API calls,
                       auth config
prisma/schema.prisma  the database structure
```

**Rule of thumb**: if you want to change something you can *see* on a
page (text, labels, layout), the file lives in `app/<that-page>/page.tsx`
or in a `components/*.tsx` file that page uses. If you want to change
*behavior* (how availability is calculated, what happens when you confirm
a slot), look in `lib/` or the matching file under `app/api/`.

---

## 2. Editing text/copy on a page

Every visible label, heading, or sentence in the app is plain text sitting
inside a `.tsx` file, wrapped in something like `<p>...</p>` or
`<span>...</span>`. To change it:

1. Figure out which page it's on, then open that page's `page.tsx` (see
   the map above). If the text is *inside a form* (e.g. the "Find us a
   time" form's fields), it's often actually in a shared `components/`
   file instead — e.g. the friends picker used on both `/events/new` and
   the saved-group form lives in `components/FriendPicker.tsx`, the
   day/time picker in `components/FiltersBuilder.tsx`.
2. Use your editor's search (Ctrl+F in most editors) for a few words of
   the exact text you want to change.
3. Edit the text between the tags. Leave the `className="..."` styling
   attribute alone unless you specifically want to change how it looks.
4. Save. `npm run dev` picks up the change automatically — no restart
   needed for text edits.

**Example**: to change a button that says "Save group", search for
`Save group` across the project (most editors have a
"search in all files" feature, usually Ctrl+Shift+F) to find which file
it's in, then edit the text directly.

---

## 3. Running the app day-to-day

```bash
cd venndra-app        # if not already there
npm run dev            # starts the app at http://localhost:3000
```

Leave that terminal open while you're using the app. `Ctrl+C` stops it.

**The one Windows-specific gotcha we hit**: any `npx prisma ...` command
needs the dev server *stopped* first. Prisma's database engine is a file
that gets locked in memory while the app is running, and Windows (unlike
Mac/Linux) won't let you overwrite a locked file. If you see
`EPERM: operation not permitted, unlink ...`, that's why — stop
`npm run dev`, run your Prisma command, then start it again.

---

## 4. Making database changes

Most edits (text, layout, sorting logic, new UI) **don't** touch the
database and need nothing beyond saving the file. You only need a
migration when you change `prisma/schema.prisma` itself — adding a new
field to a model, adding a new model, etc.

**Step 1 — apply it locally:**

```bash
# stop npm run dev first (see gotcha above)
npx prisma migrate dev --name describe_your_change_briefly
# then restart npm run dev
```

That command both updates your local Neon database to match the new
schema, and regenerates the code the app uses to talk to it. Use a short,
descriptive name in place of `describe_your_change_briefly` (e.g.
`add_profile_bio_field`) — it's just a label for your own migration
history, shown as a filename under `prisma/migrations/`.

**Step 2 — apply it to production too, *before* pushing the code live:**

```bash
DATABASE_URL="your-production-connection-string-here" npx prisma migrate deploy
```

This is easy to forget, and it's bitten us more than once — **local dev
and production are two completely separate databases**, with separate
connection strings. Running `migrate dev` only ever touches your local
one. If you push code that expects a table/column production doesn't
have yet, the live site breaks the moment someone hits that feature, even
though everything works perfectly on your machine. Note it's `migrate
deploy` here, not `migrate dev` — deploy just applies your existing
migration history as-is, without prompting for a new name, which is
exactly right for a database that isn't supposed to have anything new
*invented* for it, just replayed.

Always do this **before** `git push`, not after — that way there's never
a window where live code and the live database disagree.

---

## 5. Google: adding a new test user

Since the app isn't (and doesn't need to be) verified by Google, only
people explicitly added to a "test users" list can sign in.

1. [console.cloud.google.com](https://console.cloud.google.com) → make
   sure the right project is selected in the top dropdown
2. APIs & Services → OAuth consent screen
3. Find the **Test users** section → **+ Add users**
4. Enter their email, save

Takes effect immediately, no propagation delay. Google caps this at
**100 test users** total — plenty of headroom for a friend group, but
worth knowing if this ever grows into something bigger.

---

## 6. Microsoft: there's no test-user list

Unlike Google, Microsoft doesn't gate sign-in behind an explicit
allowlist — anyone can attempt to sign in. What actually controls who
*can* sign in successfully is the **Supported account types** setting:

- entra.microsoft.com → App registrations → your app → Authentication →
  "Supported account types"
- Needs to stay set to **"Accounts in any organizational directory and
  personal Microsoft accounts"** — this is what lets both personal
  (outlook.com/hotmail.com) and work/school Microsoft accounts sign in.
  If this ever reverts to a narrower setting, people will hit the
  `does not exist in tenant 'Microsoft Services'` error we ran into
  during setup.

No per-person action needed on the Microsoft side — anyone with a
Microsoft account can just try signing in.

---

## 7. Getting changes into the app, and out to the live site

The project is on GitHub (`github.com/Kinchilla/venndra`), and Vercel is
connected to it directly — **any push to the `main` branch automatically
triggers a live deployment**, no manual step needed on Vercel's side.
That's the real, current workflow; there's no separate "download a zip
from Claude" step anymore for getting things live.

**Making an edit, day to day:**

1. Claude describes the exact change (which file, what to find, what to
   replace it with) — you apply it directly in your own editor. For
   anything touching the database, see section 4 above first.
2. Test it locally (`npm run dev`).
3. `git add .` → `git commit -m "..."` → `git push`. Vercel picks it up
   within moments and deploys automatically.

**If Claude's own working copy ever needs to catch up with yours**
(e.g. after a stretch of hands-on edits, or if a fresh Claude
conversation needs current context): either point it at the GitHub repo
directly, or — if that's not working for some reason — zip up the
project folder yourself (excluding `node_modules`, `.next`, `.git`, and
`.env`) and upload it. Either way, Claude's copy is just a convenience
for giving you precise instructions; **GitHub is the actual source of
truth for the code**, and Vercel always deploys from there, not from
anything Claude has on hand.

---

## 8. Troubleshooting quick-reference

| Symptom | Cause | Fix |
|---|---|---|
| `npm: command not found` | Node.js isn't installed | Install the LTS version from nodejs.org |
| `'next' is not recognized...` | Dependencies not installed in this folder | `npm install` |
| SWC binary error (`not a valid Win32 application`) | Corrupted/incomplete download | Delete `node_modules`, run `npm install` again |
| `EPERM: operation not permitted, unlink ...` | Dev server running while trying to run a Prisma command | Stop `npm run dev` first, then retry |
| Bounced back to login with `?error=OAuthAccountNotLinked` | A previous sign-in attempt partially failed, leaving an orphaned user record | `npx prisma migrate reset` (wipes and cleanly reapplies — fine for dev data) |
| `We need to reset the "public" schema... All data will be lost` | `prisma/migrations/` is missing or out of sync with what the database actually remembers | Say **no**, track down a copy of `prisma/migrations/` from wherever it still exists, and make sure it's always carried forward into any new folder alongside `.env` |
| `does not exist in tenant 'Microsoft Services'` | Microsoft app registration is set to single-tenant only | Fix "Supported account types" — see section 6 above |
| Page takes 10-50+ seconds to load the *first* time | Normal — Next.js compiles each page on first visit in dev mode | Not a bug; every page after the first visit in that session is fast |
| A hydration error appears specifically around a form `<input>`, especially email/password-shaped ones | Very often a browser extension (password manager, form-filler) modifying the page before React finishes loading, not a real code bug | Test in an incognito/private window *early* — if it disappears there, it's an extension, not something to keep debugging in the code |
| `429` errors on the results page, or when joining an event, especially during active multi-person usage | The rate limiter (`lib/rateLimit.ts`) — currently 30 requests/minute on availability checks, 10/minute on joining an event, tracked per user | If it's happening during genuine normal use, the threshold's too strict for real usage patterns and worth raising. If it's a tight burst from one account, that's it working as intended |
| A wave of "couldn't check their calendar" errors arriving all at once across multiple accounts | Possibly the rate limiter's threshold being hit is causing calendar-provider requests to get throttled upstream too, not an individual token problem | Check whether it correlates with unusually rapid/repeated requests around the same time, rather than assuming it's the token-expiry issue from before |
| Prisma commands fail with a 403 on `binaries.prisma.sh` | This only happens in Claude's own sandbox (network-restricted), not on your machine | N/A for you — just context for why Claude sometimes can't fully verify a build itself |

---

## 9. What's not built yet (known gaps)

For the full, actively-maintained list of deferred features, known small
bugs, and legal/business open questions, see `venndra-next-steps.md` in
the Claude Project's knowledge base — that's the living backlog now,
kept current as things get built or new ideas come up, rather than
duplicated here where it could quietly drift out of sync.

A couple of things worth knowing right in this file, since they affect
how you work day to day: Apple/iCloud calendars are still read-only (can
contribute to availability, but can never receive the actual confirmed
event), and there's still no custom invite-notification email — invites
currently ride entirely on the calendar provider's own notification.
