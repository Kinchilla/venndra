# Venndra — "find us a time" for friend groups

Not a personal booking link (that's Calendly's job) — this is the
When2Meet problem, automated: everyone connects a calendar once, one
person picks who's invited and what kind of slot they want, and Venndra
ranks every candidate time by how many people are actually free.

This is a real, working starter — the OAuth flows, availability
computation, and event creation are functional, not mocked. You'll need
your own free API credentials before it runs, because no app (this one
included) can be pre-authorized to read your friends' calendars.

## How it works

1. **Create an event** — title, duration, optional location, which
   friends (by email) to include, day/time windows to search within (e.g.
   "weekday evenings" + "weekend daytime"), a start and end date to search
   between (a date-range picker, defaulting to today through one month
   out), and
   an optional minimum-headcount threshold.
2. **Invited friends connect a calendar** (Google, Outlook, or iCloud) if
   they haven't already — this is the only "friction" step, and it only
   happens once per person, ever.
3. **Venndra computes slots** by merging every connected participant's busy
   time against the search filters, in 30-minute increments, and ranks
   them by headcount (or lets you view in plain calendar order instead).
4. **Tentative events count as "free," but get flagged** (⚠️) so the
   organizer knows to double check with that person before locking
   anything in.
5. **The organizer confirms a slot** — Venndra creates the event on whichever
   calendar they've picked as their write target, with everyone else as an
   attendee. Standard calendar
   invite behavior then does the rest: Google→Google, Google→Outlook, etc.
   all just work, without needing write access to every participant's
   calendar.
6. **Saved groups** let you skip steps 1's people-picker next time — name
   a group once (e.g. "Family Dinner Crew"), reuse it every month.
7. **Reschedule or cancel** anytime from the event page (organizer only).
   Rescheduling reopens the search (fresh headcounts, same filters) and
   patches the *same* calendar event's time when you re-confirm, rather
   than sending a brand new invite. Cancelling a confirmed event deletes
   the real calendar event, so attendees get that provider's own
   cancellation notice — not just silence on Venndra's end.
8. **Per-calendar control, like Calendly.** If your Google or Microsoft
   account has multiple calendars (work, personal, a shared family
   calendar, etc.), you choose which ones count toward your availability
   and which single calendar (across everything you've connected) new
   events get written to — from your dashboard.
9. **Email autocomplete.** Anyone you've ever added to an event or a saved
   group gets remembered (per-user, not a real "friends" list — no
   reciprocity or acceptance involved), so typing a few characters of an
   email you've used before suggests it instead of making you retype it.
10. **12h/24h toggle** on the results page, remembered across visits.
11. **Optional ranked-choice voting.** The organizer can turn on "Participants
    vote for times" when creating an event and set how many picks each
    person gets (default 3). Voting happens right inside each slot's own
    expanded row — tap "Vote" there in the order you'd prefer (first tap
    is your 1st choice), each tap saves immediately. Everyone connected
    (organizer included) can vote; the organizer additionally sees a
    "Choose this time" button next to Vote, since only they can actually
    confirm. Vote tallies show up right alongside the calendar-availability
    info on each slot, not in a separate view. Requires a connected
    calendar to vote, same as counting toward availability — and
    confirming a slot never requires votes to exist first, it's purely an
    extra signal.

## 1. Get your API credentials (~15 min, all free)

**Google**
1. [console.cloud.google.com](https://console.cloud.google.com) → new project
2. APIs & Services → Library → enable **Google Calendar API**
3. APIs & Services → Credentials → Create Credentials → OAuth client ID → Web application
4. Authorized redirect URI: `http://localhost:3000/api/auth/callback/google` (add your production URL later too)
5. Copy the client ID/secret into `.env`

**Microsoft**
1. [entra.microsoft.com](https://entra.microsoft.com) → App registrations → New registration
2. Redirect URI (Web): `http://localhost:3000/api/auth/callback/azure-ad`
3. API permissions → add delegated `Calendars.ReadWrite` and `offline_access`
4. Certificates & secrets → new client secret
5. Copy client ID/secret/tenant ID into `.env`

**Apple** — nothing to set up in advance; each user generates their own
app-specific password at [appleid.apple.com](https://appleid.apple.com) →
Sign-In and Security → App-Specific Passwords, when they connect iCloud
from their Venndra dashboard.

## 2. Set up the database

Any Postgres works. Fastest free option:
1. Create a free project at [supabase.com](https://supabase.com) or [neon.tech](https://neon.tech)
2. Copy the connection string into `DATABASE_URL` in `.env`
3. Run:
   ```
   npm install
   npx prisma migrate dev --name init
   ```

## 3. Run it locally

```bash
cp .env.example .env   # fill in the values from steps 1-2
npm install
npx prisma migrate dev --name init
npm run dev
```

Visit `http://localhost:3000`, sign in, connect a calendar, and create
your first event search from the dashboard.

## 4. Deploy

Push to GitHub, import into [Vercel](https://vercel.com), add the same env
vars in Project Settings → Environment Variables (with production URLs in
the redirect URIs above), and add a Vercel Postgres/Supabase/Neon
`DATABASE_URL`. Vercel runs `prisma generate` automatically via the
`postinstall` script; run `npx prisma migrate deploy` once against the
production database.

## Project structure

```
app/
  page.tsx                          landing page
  login/page.tsx                    sign-in
  dashboard/page.tsx                 connected calendars, saved groups, your events
  groups/new/page.tsx                create a saved group
  events/new/page.tsx                create a "find us a time" search
  events/[id]/page.tsx               results (or a "connect your calendar" prompt if you're an un-joined invitee)
  api/
    auth/[...nextauth]/              NextAuth handler
    events/                          create/list events
    events/[id]/                     fetch one event
    events/[id]/availability/        computed, ranked slots
    events/[id]/confirm/             organizer locks in a slot -> creates the calendar event
    events/[id]/join/                attach an invited participant's account once they connect a calendar
    groups/                          saved groups CRUD
    calendars/                       list connected calendars, each with its per-calendar sources
    calendars/apple/                 connect iCloud via CalDAV
    calendars/sources/[id]/          toggle a specific calendar's availability-checking, or set it as the write target
lib/
  auth.ts                            NextAuth config; auto-registers calendars and
                                      promotes pending invitations to CONNECTED on sign-in
  availability.ts                    core group-availability algorithm
  calendarSources.ts                 lists an account's calendars and creates a CalendarSource row per one
  participants.ts                    promotes an invited participant to CONNECTED once they have a calendar
  calendar/google.ts                 Google: per-calendar, per-event status/tentative read + event creation
  calendar/microsoft.ts              Microsoft Graph: calendarView per calendar (free/tentative/busy natively) + event creation
  calendar/apple.ts                  CalDAV read per calendar (tentative via VEVENT STATUS), no write-back yet
  crypto.ts                          encrypts the Apple app-specific password at rest
prisma/schema.prisma                  data model
```

## Per-calendar selection (`CalendarSource`)

Each connected account (a Google login, a Microsoft login, or an iCloud
CalDAV connection) can contain several calendars -- work, personal, a
shared family calendar, a read-only holidays feed, etc. `populateCalendarSources`
(`lib/calendarSources.ts`) lists every calendar in an account and syncs one
`CalendarSource` row per calendar -- creating new ones, updating labels,
and removing rows for calendars that no longer exist upstream. It runs
when an account is first connected, and again automatically every time the
dashboard's calendar settings panel loads (`GET /api/calendars?sync=1`) --
so a calendar someone creates in Google later just appears next time they
check their settings, with no manual "refresh" step. Routine actions like
toggling a checkbox reuse the cached list (`GET /api/calendars`, no
`sync` param) rather than re-syncing on every click.

- **`checkAvailability`** (default `true`, per calendar) — whether that
  calendar's events count as busy time. Toggle any of them off from the
  dashboard, e.g. to stop a "US Holidays" calendar from blocking hangouts.
- **`isWriteTarget`** (default `false`, exactly one `true` across the
  user's *entire* set of connected calendars, not per-account) — which
  calendar new confirmed events get created on. Apple/iCloud calendars can
  never be a write target (see limitations below).

When an event is confirmed, the specific `CalendarSource` used is recorded
on the `Event` itself (`writeCalendarSourceId`) — rescheduling or
cancelling always targets that same calendar, even if the organizer
changes their write-target setting afterward.

## How the ranking actually works (`lib/availability.ts`)

For each connected participant, Venndra pulls their events in the search
window and classifies each one:
- **confirmed, opaque event → busy** (excludes them from that slot)
- **tentative event → still counts as free, but flags the slot**
- **transparent/"free" event, or no event → free**

Candidate slots are generated in 30-minute increments across the
organizer's chosen day/time windows (in the organizer's own timezone), and
for each slot we count how many participants are free-or-tentative.
`minAttendees`, if set, filters out anything below that headcount; sorting
is either by headcount (ties broken chronologically) or purely
chronological.

## Known limitations (this is a starter, not a finished product)

- **No Apple event write-back.** iCloud calendars can be an availability
  source (any of them, individually toggleable) but can never be the write
  target — the organizer needs a Google or Microsoft calendar connected to
  confirm a slot. Adding CalDAV `PUT` support in `lib/calendar/apple.ts`
  is the natural next step.
- **Invites ride on the calendar provider's own invite email**, not a
  custom Venndra notification — there's no in-app "hey, you've been
  invited to a search" email yet. Deliberately deferred: the plan is to
  bundle this with push notifications once there's a mobile app, rather
  than build email now and rework the notification logic again later.
  `RESEND_API_KEY` is already wired into `.env.example` for whenever that
  happens.
- **No rate limiting** on the public-ish `join`/`availability` endpoints —
  worth adding before real traffic, even though they're auth-gated.
- **Saved groups don't sync membership changes back to in-flight events** —
  editing a group (from its "Edit" page, linked off each chip on the
  dashboard) never reshuffles who's invited to a search already in
  progress, by design. It only affects future searches created from that
  group afterward.
