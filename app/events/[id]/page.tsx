import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import EventResults from "../../../components/EventResults";
import JoinPrompt from "../../../components/JoinPrompt";
import BackButton from "../../../components/BackButton";

export default async function EventPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { justCreated?: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect(`/login?callbackUrl=/events/${params.id}`);

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    include: { participants: true, creator: { select: { name: true } } },
  });
  if (!event) notFound();

  const userId = (session.user as any).id;
  const isCreator = event.creatorId === userId;
  const myParticipant = event.participants.find((p) => p.email === session.user!.email);
  if (!isCreator && !myParticipant) notFound();

  // writeCalendarSourceId is deliberately a loose id, not a Prisma relation
  // -- CalendarSource rows can be deleted out from under an old confirmed
  // event (e.g. the calendar was removed upstream), so a hard FK here would
  // risk breaking that existing behavior. Look the provider up separately.
  const writeCalendarProvider = event.writeCalendarSourceId
    ? (
        await prisma.calendarSource.findUnique({
          where: { id: event.writeCalendarSourceId },
          select: { connectedCalendar: { select: { provider: true } } },
        })
      )?.connectedCalendar.provider ?? null
    : null;

  const needsToJoin = !isCreator && myParticipant?.status === "INVITED";

  // Only when this event was just created by the form we're redirecting
  // from (see NewEventForm's justCreated=1) AND it's still SEARCHING --
  // matches exactly when "Edit this search" is offered elsewhere, so Back
  // here does the same redo-and-cancel-on-resubmit thing instead of a
  // duplicate event being left behind.
  const backToEditSearch = searchParams?.justCreated === "1" && isCreator && event.status === "SEARCHING";

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <BackButton fallbackHref="/events" href={backToEditSearch ? `/events/new?fromEvent=${event.id}` : undefined} />
      <p className="font-mono-tight text-xs uppercase tracking-widest text-teal">
        {isCreator ? "you're organizing" : `${event.creator.name ?? "Someone"} invited you`}
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold">{event.title}</h1>
      {event.location && <p className="mt-1 text-ink/60">{event.location}</p>}
      <p className="mt-1 text-sm text-ink/50">
        {event.durationMin >= 60 ? `${event.durationMin / 60} hr` : `${event.durationMin} min`} · {event.participants.length} invited
      </p>

      <div className="mt-8">
        {needsToJoin ? (
          <JoinPrompt eventId={event.id} />
        ) : (
          <EventResults
            eventId={event.id}
            isCreator={isCreator}
            status={event.status}
            confirmedStart={event.confirmedStart?.toISOString() ?? null}
            confirmedEnd={event.confirmedEnd?.toISOString() ?? null}
            votingEnabled={event.votingEnabled}
            writeCalendarProvider={writeCalendarProvider}
            organizerName={event.creator.name ?? "The organizer"}
            writeError={event.writeError}
          />
        )}
      </div>
    </main>
  );
}
