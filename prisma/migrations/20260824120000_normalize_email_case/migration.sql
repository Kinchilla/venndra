-- Backfill: bring every stored email address into the canonical form
-- lib/emailIdentity now applies on every write -- trimmed and lowercase.
--
-- No schema change. The application is what enforces the rule from here on;
-- this pass exists so the rule is true of rows written before it existed,
-- which is what lets every lookup stay an exact match instead of having to
-- allow for both spellings forever. See issue #25.
--
-- Every statement is a no-op on already-canonical data, and every one is
-- written so it CANNOT fail on a unique constraint. Where lowercasing a row
-- would collide with a row that already holds the lowercase spelling, the
-- mixed-case row is left exactly as it is rather than being merged or
-- deleted: a collision means two rows are really one person, and deciding
-- which of their events, votes and friendships survive is not something a
-- migration should do silently. Nothing is destroyed, and anything left
-- behind is findable with the query at the bottom of this file.

-- User. The identity key, and the only one of these with a global unique
-- index. DISTINCT ON picks a single winner per lowercased address (oldest
-- first) so that two mixed-case rows folding to the same address can't both
-- try to claim it; the NOT EXISTS then declines the update if a row already
-- holds the lowercase spelling.
WITH canonical AS (
  SELECT DISTINCT ON (lower(email)) id, lower(email) AS lowered
  FROM "User"
  WHERE email IS NOT NULL
  ORDER BY lower(email), "createdAt" ASC, id ASC
)
UPDATE "User" u
SET email = c.lowered
FROM canonical c
WHERE u.id = c.id
  AND u.email <> c.lowered
  AND NOT EXISTS (SELECT 1 FROM "User" o WHERE o.id <> u.id AND o.email = c.lowered);

-- EventParticipant. Bare address strings, unique per event. Same shape as
-- above, scoped to the event rather than globally.
WITH canonical AS (
  SELECT DISTINCT ON ("eventId", lower(email)) id, lower(email) AS lowered
  FROM "EventParticipant"
  ORDER BY "eventId", lower(email), "createdAt" ASC, id ASC
)
UPDATE "EventParticipant" p
SET email = c.lowered
FROM canonical c
WHERE p.id = c.id
  AND p.email <> c.lowered
  AND NOT EXISTS (
    SELECT 1 FROM "EventParticipant" o
    WHERE o.id <> p.id AND o."eventId" = p."eventId" AND o.email = c.lowered
  );

-- KnownContact. Personal autocomplete, unique per owner.
WITH canonical AS (
  SELECT DISTINCT ON ("userId", lower(email)) id, lower(email) AS lowered
  FROM "KnownContact"
  ORDER BY "userId", lower(email), "createdAt" ASC, id ASC
)
UPDATE "KnownContact" k
SET email = c.lowered
FROM canonical c
WHERE k.id = c.id
  AND k.email <> c.lowered
  AND NOT EXISTS (
    SELECT 1 FROM "KnownContact" o
    WHERE o.id <> k.id AND o."userId" = k."userId" AND o.email = c.lowered
  );

-- SavedGroup.emails is a text[] with no constraint on it, so this one both
-- lowercases and collapses the duplicates lowercasing creates. GROUP BY on
-- the lowered value with min(ordinality) keeps the chips in the order the
-- owner arranged them, with each address at the position it first appeared.
UPDATE "SavedGroup" g
SET emails = ARRAY(
  SELECT d.lowered
  FROM (
    SELECT lower(t.e) AS lowered, min(t.ord) AS first_ord
    FROM unnest(g.emails) WITH ORDINALITY AS t(e, ord)
    GROUP BY lower(t.e)
  ) d
  ORDER BY d.first_ord
)
WHERE EXISTS (SELECT 1 FROM unnest(g.emails) AS e WHERE e <> lower(e));

-- ConnectedCalendar. accountEmail is matched against User.email by
-- lib/identityAccount; caldavUsername is matched by the re-add check in
-- app/api/calendars/apple. Neither is constrained, so a plain update.
UPDATE "ConnectedCalendar"
SET "accountEmail" = lower("accountEmail")
WHERE "accountEmail" IS NOT NULL AND "accountEmail" <> lower("accountEmail");

UPDATE "ConnectedCalendar"
SET "caldavUsername" = lower("caldavUsername")
WHERE "caldavUsername" IS NOT NULL AND "caldavUsername" <> lower("caldavUsername");

-- VerificationToken.identifier is an email address too. These live ten
-- minutes, so this is almost certainly touching nothing -- included so the
-- statement "no email column in this database holds a mixed-case value" has
-- no exceptions to remember. Its unique index is (identifier, token) and
-- token is unique on its own, so no collision is possible.
UPDATE "VerificationToken"
SET identifier = lower(identifier)
WHERE identifier <> lower(identifier);

-- Afterwards, this should return no rows. Anything it does return is a
-- collision the statements above deliberately declined to resolve:
--
--   SELECT 'User' AS t, email AS v FROM "User" WHERE email <> lower(email)
--   UNION ALL SELECT 'EventParticipant', email FROM "EventParticipant" WHERE email <> lower(email)
--   UNION ALL SELECT 'KnownContact', email FROM "KnownContact" WHERE email <> lower(email)
--   UNION ALL SELECT 'ConnectedCalendar', "accountEmail" FROM "ConnectedCalendar" WHERE "accountEmail" <> lower("accountEmail")
--   UNION ALL SELECT 'SavedGroup', e FROM "SavedGroup", unnest(emails) AS e WHERE e <> lower(e);
