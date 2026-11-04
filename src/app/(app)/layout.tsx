import Link from "next/link";
import type { ReactNode } from "react";

import { requireStaff } from "@/auth/server";
import { SignOutButton } from "@/components/sign-out-button";

// Every page here depends on the session cookie.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaff();
  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
          <Link href="/blog" className="text-sm font-semibold">
            DRP <span className="text-accent">CMS</span>
          </Link>
          <nav className="flex gap-4 text-sm text-zinc-600">
            <Link href="/blog" className="hover:text-zinc-900">Blog</Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-zinc-500">
            <span className="hidden sm:inline">{staff.email}</span>
            <SignOutButton className="btn-secondary py-1.5" />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
