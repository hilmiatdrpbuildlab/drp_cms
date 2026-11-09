import Link from "next/link";

const TABS = [
  ["overview", "/insights", "Subscribers"],
  ["activity", "/insights/activity", "Reader activity"],
  ["offers", "/insights/offers", "Offers"],
] as const;

export function InsightsTabs({ active }: { active: (typeof TABS)[number][0] }) {
  return (
    <nav className="flex gap-1 border-b border-zinc-200 text-sm" aria-label="Insights">
      {TABS.map(([key, href, label]) => (
        <Link
          key={key}
          href={href}
          aria-current={key === active ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 font-medium ${key === active ? "border-accent text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-900"}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
