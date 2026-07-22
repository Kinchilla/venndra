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
  settings/page.tsx    → "/settings"
  events/new/page.tsx  → "/events/new" ("Find us a time" form)
  events/[id]/page.tsx → "/events/some-id" (one event's results page)
  groups/new/page.tsx  → "/groups/new"
  groups/[id]/edit/    → "/groups/some-id/edit"
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
   file instead — e.g. the email-chip input lives in
   `components/EmailListInput.tsx`, the day/time picker in
   `components/FiltersBuilder.tsx`.
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

If you do edit `schema.prisma`:

```bash
# 1. stop npm run dev first (see gotcha above)
npx prisma migrate dev --name describe_your_change_briefly
# 2. restart npm run dev
```

That command both updates your actual Neon database to match the new
schema, and regenerates the code the app uses to talk to it. Use a short,
descriptive name in place of `describe_your_change_briefly` (e.g.
`add_profile_bio_field`) — it's just a label for your own migration
history, shown as a filename under `prisma/migrations/`.

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

## 7. Getting updates from Claude

Claude keeps one continuously-evolving copy of the project's source code.
Every change discussed in chat gets applied to that copy directly, one
file at a time — a "zip download" is just a snapshot of everything
accumulated since your last one, not a separate branch. Practically:

- **Small, single-file changes** (a text tweak, a one-line logic fix):
  Claude can usually just tell you the exact edit to make by hand — often
  faster than a full folder swap.
- **Bigger, multi-file changes**: grab a fresh zip, extract it into a new
  folder, then copy **two things** over from your previous folder before
  running anything:
  1. `.env` — never included in the zip, since it holds your real secrets.
  2. `prisma/migrations/` — **also never included in the zip.** This
     folder only ever gets created locally, the first time you run
     `npx prisma migrate dev` on your own machine — Claude's own sandbox
     can't generate it (a network restriction on Claude's end blocks the
     command that creates it). If you skip carrying this folder over,
     Prisma will see your fresh folder as having *no* migration history
     while your actual database remembers every migration you've really
     run — and will prompt to **reset the entire database** to
     reconcile, which deletes all your data. Always copy this folder
     forward; never let Prisma "fix" the mismatch by resetting unless
     you've genuinely decided you don't need the existing data.
  3. Then `npm install` in the new folder.
- **Database changes**: only run `npx prisma migrate dev` if Claude
  specifically says the schema changed. Most feature updates don't touch
  the database at all.

---

## 8. Troubleshooting quick-reference

| Symptom | Cause | Fix |
|---|---|---|
| `npm: command not found` | Node.js isn't installed | Install the LTS version from nodejs.org |
| `'next' is not recognized...` | Dependencies not installed in this folder | `npm install` |
| SWC binary error (`not a valid Win32 application`) | Corrupted/incomplete download | Delete `node_modules`, run `npm install` again |
| `EPERM: operation not permitted, unlink ...` | Dev server running while trying to run a Prisma command | Stop `npm run dev` first, then retry |
| Bounced back to login with `?error=OAuthAccountNotLinked` | A previous sign-in attempt partially failed, leaving an orphaned user record | `npx prisma migrate reset` (wipes and cleanly reapplies — fine for dev data) |
| `We need to reset the "public" schema... All data will be lost` | `prisma/migrations/` wasn't carried over into a freshly-extracted folder (see section 7) | Say **no**, copy `prisma/migrations/` over from your previous folder, then retry the migrate command |
| `does not exist in tenant 'Microsoft Services'` | Microsoft app registration is set to single-tenant only | Fix "Supported account types" — see section 6 above |
| Page takes 10-50+ seconds to load the *first* time | Normal — Next.js compiles each page on first visit in dev mode | Not a bug; every page after the first visit in that session is fast |
| Prisma commands fail with a 403 on `binaries.prisma.sh` | This only happens in Claude's own sandbox (network-restricted), not on your machine | N/A for you — just context for why Claude sometimes can't fully verify a build |

---

## 9. What's not built yet (known gaps)

See the "Known limitations" section near the bottom of `README.md` for
the full list — a few highlights: no Apple/iCloud event write-back, no
custom invite-notification emails, no rate limiting on public-ish
endpoints, and the app isn't deployed anywhere yet (still local-only).
