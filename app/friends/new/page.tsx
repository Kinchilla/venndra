import { redirect } from "next/navigation";
import NewFriendForm from "../../../components/NewFriendForm";
import { currentUser } from "../../../lib/session";

export default async function NewFriendPage() {
  const sessionUser = await currentUser();
  // The form itself is a client component (components/NewFriendForm), which is
  // why this page exists as a shell -- the guard has to run on the server, and
  // signed out there is nothing here that works. Every route the form touches
  // 401s, and it renders those failures badly: /api/friends/check comes back
  // without an `exists`, so the falsy branch wins and the form tells you no
  // Venndra profile exists for whatever address you typed, which is a
  // confident lie rather than an error.
  if (!sessionUser) redirect("/login?callbackUrl=/friends/new");

  return <NewFriendForm />;
}
