import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../../lib/prisma";
import { applyNotificationToggle } from "../../../../lib/notifications/prefs";
import { NOTIFICATION_TRIGGER_IDS } from "../../../../lib/notifications/triggers";
import { jsonBody } from "../../../../lib/requestBody";
import { currentUser, unauthorized } from "../../../../lib/session";

const schema = z.object({
  trigger: z.enum(NOTIFICATION_TRIGGER_IDS as [string, ...string[]]),
  enabled: z.boolean(),
});

/**
 * One toggle per request, not the whole map -- matches how
 * NotificationSettingsForm renders (a list of independent checkboxes, no
 * shared "Save" button) and keeps a single flip from being able to clobber
 * a change made in another tab.
 *
 * Read-modify-write rather than a Prisma partial-JSON update: Prisma has no
 * "merge into this JSON column" operation, and contention is a non-issue --
 * this is one person editing their own settings, not a shared row.
 */
export async function PATCH(req: NextRequest) {
  const sessionUser = await currentUser();
  if (!sessionUser) return unauthorized();

  const parsed = schema.safeParse(await jsonBody(req));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: { notificationPrefs: true },
  });
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const next = applyNotificationToggle(
    user.notificationPrefs,
    parsed.data.trigger as (typeof NOTIFICATION_TRIGGER_IDS)[number],
    parsed.data.enabled
  );

  const updated = await prisma.user.update({
    where: { id: sessionUser.id },
    data: { notificationPrefs: next },
  });

  return NextResponse.json({ notificationPrefs: updated.notificationPrefs });
}
