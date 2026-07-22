"use client";

import { signOut } from "next-auth/react";

export default function LogoutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/" })}
      className="text-sm text-ink/50 hover:text-red-600 transition-colors"
    >
      Log out
    </button>
  );
}
