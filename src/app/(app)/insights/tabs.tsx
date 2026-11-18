import Link from "next/link";

import { getStaff } from "@/auth/server";

const TABS = [
  ["overview", "/insights", "Subscribers", false],
  ["activity", "/insights/activity", "Reader activity", false],
  ["offers", "/insights/offers", "Offers", false],
  ["website", "/insights/website", "Website", true],
] as const;

/** Admin-only tabs are hidden from everyone else; their pages check again. */
export async function InsightsTabs({ active }: { active: (typeof TABS)[number][0] }) {
  const isAdmin = (await getStaff())?.isAdmin ?? false;
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-zinc-200 text-sm" aria-label="Insights">
      {TABS.filter(([, , , adminOnly]) => isAdmin || !adminOnly).map(([key, href, label]) => (
        <Link
          key={key}
          href={href}
          aria-current={key === active ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 font-medium whitespace-nowrap ${key === active ? "border-accent text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-900"}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
