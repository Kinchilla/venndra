# Venndra

"When's everyone free?" — answered automatically, for a group of friends.

Not a personal booking link (that's Calendly's job). This is the When2Meet
problem, without the spreadsheet: everyone connects a calendar once, one
person says who's invited and what kind of slot they want, and Venndra
ranks every candidate time by how many people are actually free.

## How it works

1. **Sign in and connect a calendar** — magic link, Google, or Microsoft to
   sign in; Google, Outlook, or iCloud for the calendar. The connect step
   happens once per person, ever.
2. **Add friends.** Events and saved groups are built from people who've
   accepted a friend request, so nobody gets pulled into a search by a
   stranger who guessed their email.
3. **Create an event** — title, duration, which friends, which day/time
   windows to search within ("weekday evenings", "weekend daytime"), a date
   range, and an optional minimum headcount.
4. **Venndra ranks the slots**, merging every participant's busy time in
   30-minute increments. Tentative events still count as free, but the slot
   gets flagged so the organizer knows to double-check.
5. **The organizer confirms one**, and Venndra creates the real calendar
   event with everyone else as an attendee — so the provider's own invite
   handles the rest, Google→Outlook included, without Venndra needing write
   access to anyone else's calendar.
6. **Plans change**: reschedule, cancel, hand the event to a new organizer,
   or drop out yourself. Each of those updates the real calendar event, not
   just Venndra's copy of it.

Optional extras: ranked-choice voting on candidate times, saved groups for
people you plan with repeatedly, and per-calendar control over which of your
calendars count toward your availability and which one events get written to.

## Running it locally

You'll need your own API credentials first — no app, this one included, can
be pre-authorized to read your friends' calendars.

- **Google** — [console.cloud.google.com](https://console.cloud.google.com):
  new project → enable the Google Calendar API → Credentials → OAuth client
  ID (Web) → redirect URI `http://localhost:3000/api/auth/callback/google`.
- **Microsoft** — [entra.microsoft.com](https://entra.microsoft.com): App
  registrations → New registration → redirect URI
  `http://localhost:3000/api/auth/callback/azure-ad` → delegated
  `Calendars.ReadWrite` and `offline_access` → a client secret.
- **Apple** — nothing in advance. Each user generates their own
  app-specific password at [appleid.apple.com](https://appleid.apple.com)
  when they connect iCloud.
- **Database** — any Postgres. A free project on
  [neon.tech](https://neon.tech) or [supabase.com](https://supabase.com) is
  the quickest start.

Then:

```bash
cp .env.example .env   # fill in the credentials above, plus DATABASE_URL
npm install
npx prisma migrate dev --name init
npm run dev
```

`.env.example` documents every variable, including which are optional in
development.

## Built with

Next.js 14 (App Router) · TypeScript · Prisma + Postgres · NextAuth ·
Tailwind · Resend. Calendar access goes through the Google Calendar API,
Microsoft Graph, and CalDAV respectively.

## A known limitation

iCloud can be the calendar events get written to, but CalDAV offers no
reliable way to trigger Apple's own invitation emails. Confirming a slot
with Apple as the write target puts the event on the organizer's calendar
only, and the app tells them to invite people manually. Google and Microsoft
send real invites as normal.
