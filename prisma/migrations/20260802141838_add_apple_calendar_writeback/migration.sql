-- AlterTable
ALTER TABLE "CalendarSource" ADD COLUMN     "writeTargetAutoAssigned" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "externalEventEtag" TEXT,
ADD COLUMN     "externalEventHref" TEXT,
ADD COLUMN     "writeError" TEXT;
