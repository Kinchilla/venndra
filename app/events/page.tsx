import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "../../lib/auth";
import { prisma } from "../../lib/prisma";
import BackButton from "../../components/BackButton";
import EventChip from "../../components/EventChip";
import ClearSectionButton from "../../components/ClearSectionButton";

export default async function EventsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const userId = (session.user as any).id;
  const events = await prisma.event.findMany({
    where: { OR: [{ creatorId: userId }, { participants: { some: { email: session.user.email ?? "" } } }] },
    include: {
      participants: { include: { user: { select: { name: true } } } },
      creator: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // writeCalendarSourceId is deliberately a loose id, not a Prisma relation
  // (see app/events/[id]/page.tsx for why) -- batch-look-up the provider
  // for every referenced write target in one query rather than one per event.
  const writeSourceIds = [...new Set(events.map((e) => e.writeCalendarSourceId).filter((id): id is string => !!id))];
  const writeSources = writeSourceIds.length
    ? await prisma.calendarSource.findMany({
        where: { id: { in: writeSourceIds } },
        select: { id: true, connectedCalendar: { select: { provider: true } } },
      })
    : [];
  const writeProviderBySourceId = new Map(writeSources.map((s) => [s.id, s.connectedCalendar.provider]));

  const now = new Date();
  const isPast = (e: any) => e.confirmedEnd !== null && e.confirmedEnd < now;

  const confirmed = events.filter((e) => e.status === "CONFIRMED" && !isPast(e));
  const past = events.filter((e) => e.status === "CONFIRMED" && isPast(e));
  const inProgress = events.filter((e) => e.status === "SEARCHING");
  const cancelled = events.filter((e) => e.status === "CANCELLED");

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <BackButton fallbackHref="/" />
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">Events</h1>
        <Link href="/events/new" className="rounded-full bg-amber px-4 py-2 text-sm font-medium text-white">
          + New event
        </Link>
      </div>

      <EventSection title="Confirmed" events={confirmed} userId={userId} isPast={isPast} writeProviderBySourceId={writeProviderBySourceId} />
      <EventSection title="Still deciding" events={inProgress} userId={userId} isPast={isPast} writeProviderBySourceId={writeProviderBySourceId} />
      {past.length > 0 && (
        <EventSection title="Past" events={past} userId={userId} isPast={isPast} writeProviderBySourceId={writeProviderBySourceId} muted showClear />
      )}
      {cancelled.length > 0 && (
        <EventSection title="Cancelled" events={cancelled} userId={userId} isPast={isPast} writeProviderBySourceId={writeProviderBySourceId} muted showClear />
      )}
    </main>
  );
}

function EventSection({
  title,
  events,
  userId,
  isPast,
  writeProviderBySourceId,
  muted = false,
  showClear = false,
}: {
  title: string;
  events: any[];
  userId: string;
  isPast: (e: any) => boolean;
  writeProviderBySourceId: Map<string, string>;
  muted?: boolean;
  showClear?: boolean;
}) {
  const myEventIds = events.filter((e) => e.creatorId === userId).map((e) => e.id);

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        {showClear && <ClearSectionButton eventIds={myEventIds} />}
      </div>
      <div className="mt-3 grid gap-2">
        {events.map((e) => (
          <div key={e.id} className={muted ? "opacity-60" : ""}>
            <EventChip
              event={{
                id: e.id,
                title: e.title,
                organizerName: e.creatorId === userId ? "You" : e.creator.name ?? e.creator.email ?? "Someone",
                isOrganizer: e.creatorId === userId,
                creatorId: e.creatorId,
                isPast: isPast(e),
                status: e.status,
                participants: e.participants.map((p: any) => ({
                  email: p.email,
                  userId: p.userId,
                  status: p.status,
                  name: p.user?.name ?? null,
                })),
                durationMin: e.durationMin,
                searchStart: e.searchStart.toISOString(),
                searchEnd: e.searchEnd.toISOString(),
                filters: e.filters,
                minAttendees: e.minAttendees,
                confirmedStart: e.confirmedStart?.toISOString() ?? null,
                confirmedEnd: e.confirmedEnd?.toISOString() ?? null,
                writeCalendarProvider: e.writeCalendarSourceId ? writeProviderBySourceId.get(e.writeCalendarSourceId) ?? null : null,
                writeError: e.writeError,
              }}
            />
          </div>
        ))}
        {events.length === 0 && <p className="text-sm text-ink/50">Nothing here yet.</p>}
      </div>
    </section>
  );
}