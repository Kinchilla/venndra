-- AlterTable
ALTER TABLE "ConnectedCalendar" ADD COLUMN     "accountEmail" TEXT;

-- Backfill Apple/iCloud rows: caldavUsername is already the iCloud address.
UPDATE "ConnectedCalendar"
SET "accountEmail" = "caldavUsername"
WHERE "caldavUsername" IS NOT NULL;

-- Backfill Google/Microsoft rows from the owning user's email. This is only
-- correct because it runs before anyone can have linked a second OAuth
-- account: until "connect another account" shipped alongside this migration,
-- the sole OAuth calendar a user could have was the one from their own
-- sign-in, so User.email IS that account's email. Rows created after this
-- point get accountEmail written directly by events.linkAccount instead.
UPDATE "ConnectedCalendar" cc
SET "accountEmail" = u."email"
FROM "User" u
WHERE cc."userId" = u."id"
  AND cc."nextAuthAccountId" IS NOT NULL
  AND cc."accountEmail" IS NULL
  AND u."email" IS NOT NULL;
