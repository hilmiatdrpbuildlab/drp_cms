import { desc } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";

import { requireStaff } from "@/auth/server";
import { getDb } from "@/lib/db";
import { offers } from "@/lib/schema";

import { InsightsTabs } from "../tabs";
import { createOffer } from "./actions";

export const metadata: Metadata = { title: "Offers" };

const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Brussels" });

const STATUS: Record<string, [string, string]> = {
  draft: ["Draft", "bg-zinc-100 text-zinc-600"],
  sending: ["Partly sent", "bg-amber-100 text-amber-800"],
  sent: ["Sent", "bg-emerald-100 text-emerald-800"],
};

export default async function OffersList() {
  await requireStaff();
  let rows: (typeof offers.$inferSelect)[] | null = null;
  try {
    rows = await getDb().select().from(offers).orderBy(desc(offers.updatedAt));
  } catch (e) {
    console.error("[offers] list", e instanceof Error ? e.message : e);
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Insights</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Offers go only to subscribers who agreed to them, in their own language, optionally only to those interested in certain tags.
          </p>
        </div>
        {rows && (
          <form action={createOffer}>
            <button className="btn-primary">New offer</button>
          </form>
        )}
      </div>
      <InsightsTabs active="offers" />

      {!rows ? (
        <p className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          The offers tables are missing. Run <code className="text-xs">npm run db:migrate</code> (migration 0004_offers).
        </p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-500">
          No offers yet. You can write and test one now; sending unlocks after the lawyer approves the consent texts.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Offer</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Audience</th>
                <th className="px-4 py-2.5 font-medium">Languages</th>
                <th className="px-4 py-2.5 font-medium">Recipients</th>
                <th className="px-4 py-2.5 font-medium">Last change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((o) => {
                const [label, cls] = STATUS[o.status];
                return (
                  <tr key={o.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3">
                      <Link href={`/insights/offers/${o.id}`} className="font-medium hover:text-accent">
                        {o.name}
                      </Link>
                      {o.partner && <div className="text-xs text-zinc-400">Partner: {o.partner}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-600">{o.audienceTags.length ? o.audienceTags.join(", ") : "Everyone with consent"}</td>
                    <td className="px-4 py-3 text-xs text-zinc-500 uppercase">{Object.keys(o.versions).join(" ") || "—"}</td>
                    <td className="px-4 py-3 tabular-nums">{o.results.length ? o.results.reduce((n, r) => n + r.recipients, 0) : "—"}</td>
                    <td className="px-4 py-3 text-xs text-zinc-500">
                      {fmt.format(o.sentAt ?? o.updatedAt)}
                      <div>{o.sentBy ?? o.updatedBy}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
