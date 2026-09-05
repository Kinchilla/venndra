import { prisma } from "../prisma";
import { sendEmail } from "../email";
import { isEmailEnabled } from "./prefs";
import type { NotificationTrigger } from "./triggers";

/**
 * The one place a Venndra event turns into an email, mirroring lib/email.ts's
 * own "single choke point" rule one level up: every notification email goes
 * through this function, so "what does Venndra notify people about, and can
 * they turn it off" has one answer.
 *
 * `build` is a thunk rather than a plain `{ subject, text, html }` object so
 * that call sites fanning out to several recipients (event_confirmed,
 * event_cancelled) don't build a template string for someone who has this
 * trigger turned off -- cheap today since every template is just string
 * concatenation, but it keeps the contract honest if a template ever needs
 * a query of its own.
 *
 * Never throws. This runs after the real action it's reporting on has
 * already succeeded -- the friendship row is written, the event is
 * CONFIRMED -- and a Resend hiccup here must not turn that into a 500 for
 * the person who took the action. Logged with a message that's the same
 * string for every failure of a given trigger (never interpolating the
 * user id into the text) so Sentry groups them as one alert per trigger
 * rather than one per person it happened to.
 */
export async function notifyUser(
  userId: string,
  trigger: NotificationTrigger,
  build: () => { subject: string; text: string; html: string }
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, notificationPrefs: true },
    });
    if (!user?.email) return;
    if (!isEmailEnabled(user.notificationPrefs, trigger)) return;

    const { subject, text, html } = build();
    await sendEmail({ to: user.email, subject, text, html });
  } catch (err) {
    console.error(`Failed to send ${trigger} notification`, { userId, err });
  }
}

/** Same as notifyUser, for the handful of triggers that fan out to several people at once. */
export async function notifyUsers(
  userIds: string[],
  trigger: NotificationTrigger,
  build: () => { subject: string; text: string; html: string }
): Promise<void> {
  await Promise.all(userIds.map((userId) => notifyUser(userId, trigger, build)));
}
