import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import NewEventForm from "../../../components/NewEventForm";
import { WeeklyHours } from "../../../components/FiltersBuilder";

// This page reads the user's saved default search filters fresh on every
// visit -- Next's client-side Router Cache would otherwise happily serve a
// 30-second-stale version after a soft (client-side) navigation, which is
// exactly wrong right after saving a new default in /settings. Forcing
// dynamic + no-store disables that caching specifically for this route,
// without affecting caching behavior anywhere else in the app.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function NewEventPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/events/new");

  const userId = (session.user as any).id;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) redirect("/login");

  return <NewEventForm initialDefaultFilters={(user.defaultSearchFilters as WeeklyHours | null) ?? null} />;
}