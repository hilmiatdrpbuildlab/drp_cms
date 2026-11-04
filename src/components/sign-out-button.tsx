"use client";

import { useState } from "react";

import { authClient } from "@/auth/client";

export function SignOutButton({ className = "btn-secondary" }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await authClient.signOut();
        window.location.assign("/sign-in");
      }}
    >
      Sign out
    </button>
  );
}
