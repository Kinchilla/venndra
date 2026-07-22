import { prisma } from "./prisma";

/**
 * Whenever a user connects a calendar (Google/Microsoft sign-in, or Apple
 * via CalDAV), retroactively mark them CONNECTED on any events they were
 * invited to by email but hadn't yet linked an account/calendar for.
 */
export async function syncParticipantStatusForUser(userId: string, email: string) {
  await prisma.eventParticipant.updateMany({
    where: { email, status: "INVITED" },
    data: { userId, status: "CONNECTED" },
  });
}
