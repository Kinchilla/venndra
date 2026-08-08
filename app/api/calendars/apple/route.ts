import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "../../../../lib/auth";
import { prisma } from "../../../../lib/prisma";
import { encrypt } from "../../../../lib/crypto";
import { syncParticipantStatusForUser } from "../../../../lib/participants";
import { populateCalendarSources } from "../../../../lib/calendarSources";

const appleSchema = z.object({
  appleId: z.string().email(), // the iCloud email, used as the CalDAV username
  appSpecificPassword: z.string().min(16),
  label: z.string().default("iCloud"),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = appleSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { appleId, appSpecificPassword, label } = parsed.data;
  const userId = (session.user as any).id;

  // Re-adding an iCloud account that's already here -- most likely one
  // disconnected earlier, or one whose app-specific password was revoked at
  // Apple and regenerated -- updates that row instead of creating a second
  // one. Without this, disconnect + reconnect-via-this-form would leave two
  // rows for the same iCloud address, both listed, only one live.
  const existing = await prisma.connectedCalendar.findFirst({
    where: { userId, provider: "APPLE_CALDAV", caldavUsername: appleId },
  });

  const data = {
    caldavUrl: "https://caldav.icloud.com",
    caldavUsername: appleId,
    caldavPasswordEncrypted: encrypt(appSpecificPassword),
    accountEmail: appleId, // same value as caldavUsername, stored uniformly so the UI can read one field across all providers
    label,
    isEnabled: true,
  };

  const connected = existing
    ? await prisma.connectedCalendar.update({ where: { id: existing.id }, data })
    : await prisma.connectedCalendar.create({ data: { userId, provider: "APPLE_CALDAV", ...data } });

  await populateCalendarSources(connected.id);

  if (session.user.email) await syncParticipantStatusForUser(userId, session.user.email);

  return NextResponse.json({ connectedCalendar: { id: connected.id, label: connected.label } }, { status: 201 });
}
