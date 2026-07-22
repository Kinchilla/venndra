import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import EventResults from "../../../components/EventResults";
import JoinPrompt from "../../../components/JoinPrompt";
import BackButton from "../../../components/BackButton";

export default async function EventPage({ params }: { params: { id: string } }) {
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

  const needsToJoin = !isCreator && myParticipant?.status === "INVITED";

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <BackButton fallbackHref="/events" />
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
          />
        )}
      </div>
    </main>
  );
}
