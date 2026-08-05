import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import NewEventForm from "../../../components/NewEventForm";
import { WeeklyHours } from "../../../components/FiltersBuilder";

export default async function NewEventPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/events/new");

  const userId = (session.user as any).id;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) redirect("/login");

  return <NewEventForm initialDefaultFilters={(user.defaultSearchFilters as WeeklyHours | null) ?? null} />;
}