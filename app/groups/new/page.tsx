import BackButton from "../../../components/BackButton";
import GroupForm from "../../../components/GroupForm";

export default function NewGroupPage() {
  return (
    <main className="mx-auto max-w-lg px-6 py-12">
      <BackButton fallbackHref="/groups" />
      <h1 className="font-display text-2xl font-semibold">New saved group</h1>
      <p className="mt-1 text-ink/60">Reuse this any time you need to find a slot with the same people.</p>
      <GroupForm />
    </main>
  );
}
