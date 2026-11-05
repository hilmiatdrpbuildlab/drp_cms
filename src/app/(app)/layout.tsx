import { count, eq } from "drizzle-orm";
import type { ReactNode } from "react";

import { requireStaff } from "@/auth/server";
import { SignOutButton } from "@/components/sign-out-button";
import { getDb } from "@/lib/db";
import { blogComments } from "@/lib/schema";

import { NavLink } from "./nav-link";

// Every page here depends on the session cookie.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaff();
  const [{ pending }] = await getDb().select({ pending: count() }).from(blogComments).where(eq(blogComments.status, "pending"));
  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4">
          <span className="text-base font-semibold">
            DRP <span className="text-accent">CMS</span>
          </span>
          <nav className="flex gap-1 text-[15px]">
            <NavLink href="/blog">Articles</NavLink>
            <NavLink href="/comments">
              Comments
              {pending > 0 && (
                <span className="ml-1.5 rounded-full bg-red-600 px-1.5 py-0.5 text-xs font-semibold text-white" title={`${pending} waiting for approval`}>
                  {pending}
                </span>
              )}
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-zinc-500">
            <span className="hidden sm:inline">{staff.name}</span>
            <SignOutButton className="btn-secondary py-1.5" />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
