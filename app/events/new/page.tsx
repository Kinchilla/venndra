import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import { hasUsableCalendar } from "../../../lib/onboarding";
import NewEventForm from "../../../components/NewEventForm";
import { WeeklyHours } from "../../../components/FiltersBuilder";

export default async function NewEventPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/events/new");

  const userId = (session.user as any).id;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) redirect("/login");

  // The one page that's blocked rather than merely nudged. A search with no
  // calendar behind it isn't a degraded search, it's a broken object: the
  // organizer is a participant in their own event, so every candidate slot
  // would be computed against an empty schedule and the results would claim
  // they're free at times they aren't. Everyone invited then votes on times
  // sourced from a fiction. Better to not let it be created.
  //
  // Elsewhere a banner is enough -- see components/ConnectCalendarBanner.
  if (!(await hasUsableCalendar(userId))) redirect("/settings?needsCalendar=1");

  return <NewEventForm initialDefaultFilters={(user.defaultSearchFilters as WeeklyHours | null) ?? null} />;
}