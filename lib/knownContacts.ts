import { prisma } from "./prisma";

/**
 * Remembers which emails a user has typed in before (via an event or a
 * saved group), so the email input can suggest them later instead of
 * making people retype the same person's address every time. Not a real
 * "friends" relationship -- no reciprocity, nothing the other person sees.
 */
export async function recordKnownContacts(userId: string, emails: string[]): Promise<void> {
  if (emails.length === 0) return;
  await prisma.knownContact.createMany({
    data: emails.map((email) => ({ userId, email })),
    skipDuplicates: true,
  });
}
