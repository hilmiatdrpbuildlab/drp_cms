"use client";

import { useState } from "react";

import { authClient } from "@/auth/client";

/**
 * `microsoft`: signed in through Cloudflare Access. Sign out then goes through /sso/logout, which
 * also ends the shared sign-in session for the other internal apps.
 */
export function SignOutButton({ className = "btn-secondary", microsoft = false }: { className?: string; microsoft?: boolean }) {
  const [busy, setBusy] = useState(false);
  if (microsoft) {
    return (
      <form method="post" action="/sso/logout" onSubmit={() => setBusy(true)}>
        <button className={className} disabled={busy}>
          Sign out
        </button>
      </form>
    );
  }
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
