import type { Metadata } from "next";
import { Suspense } from "react";

import { requireStaff } from "@/auth/server";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { summarize, type OfferConsentInfo, type Subscriber } from "@/lib/insights/newsletter";
import { consentsAndInterests, offersSetup } from "@/lib/insights/offers-server";
import { getSubscribers, resendConfigured } from "@/lib/resend";
import { consentRequests } from "@/lib/schema";

import { ArticleEmails } from "./article-emails";
import { LanguageBars, MonthColumns } from "./charts";
import { OffersPanel } from "./offers-panel";
import { SubscriberTable } from "./subscriber-table";
import { InsightsTabs } from "./tabs";

export const metadata: Metadata = { title: "Insights" };

function Card({ title, note, children, flush }: { title: string; note?: string; children: React.ReactNode; flush?: boolean }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white">
      <header className="border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {note && <p className="mt-0.5 text-xs text-zinc-500">{note}</p>}
      </header>
      {flush ? children : <div className="p-4">{children}</div>}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

export default async function Insights() {
  await requireStaff();

  if (!resendConfigured()) {
    return (
      <Shell>
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-600">
          Insights reads the blog newsletter from Resend, and <code className="text-xs">RESEND_API_KEY</code> is not set. Add a
          full-access key from the Resend team that drpbuildlab.com uses (see README.md).
        </div>
      </Shell>
    );
  }

  let subscribers: Subscriber[];
  try {
    subscribers = await getSubscribers();
  } catch (e) {
    console.error("[insights] subscribers failed", e instanceof Error ? e.message : e);
    return (
      <Shell>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          Could not read the subscribers from Resend. Reload the page to try again. If it keeps failing, check that{" "}
          <code className="text-xs">RESEND_API_KEY</code> has full access.
        </div>
      </Shell>
    );
  }

  const s = summarize(subscribers);
  const active = subscribers.filter((x) => !x.unsubscribed);

  // Phase 2. Before the offers migration has run, the page still works without it.
  const setup = await offersSetup();
  let offers: Record<string, OfferConsentInfo> = {};
  let notAsked = 0;
  let offersDbError = false;
  try {
    const [{ consents, interests }, asked] = await Promise.all([
      consentsAndInterests(),
      getDb().select({ email: consentRequests.email }).from(consentRequests),
    ]);
    for (const [email, c] of consents) offers[email] = { ...c, interests: interests.get(email) ?? [] };
    const skip = new Set(asked.map((a) => a.email));
    notAsked = active.filter((x) => !skip.has(x.email) && !offers[x.email]?.optedIn).length;
  } catch (e) {
    console.error("[insights] offers tables", e instanceof Error ? e.message : e);
    offers = {};
    offersDbError = true;
  }
  const consenting = active.filter((x) => offers[x.email]?.optedIn).length;
  const env = getEnv();

  return (
    <Shell exportable offersReady={setup.ready}>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Active subscribers" value={s.active} />
        <Stat label="New in the last 30 days" value={s.newLast30Days} />
        <Stat label="Unsubscribed" value={s.unsubscribed} hint="Kept so they get nothing more" />
        <Stat label="Languages" value={s.byLang.length} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Active subscribers by language" note="The language they subscribed in; they get the article in that language.">
          <LanguageBars data={s.byLang} />
        </Card>
        <Card title="New subscribers per month" note="Confirmed sign-ups, last 12 months. Hover a column for its number.">
          <MonthColumns data={s.byMonth} />
        </Card>
      </div>

      <Card
        title="New-article emails"
        note="The 15 most recent, per language. Counts are people, read live from Resend. Opens are approximate: some mail apps open every email automatically, others block tracking."
        flush
      >
        <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading email results from Resend…</p>}>
          <ArticleEmails />
        </Suspense>
      </Card>

      <Card
        title="Offers consent"
        note="Who also agreed to offers from DRP BuildLab and partners. Their clicks on articles in our emails become their interests."
        flush
      >
        {offersDbError ? (
          <p className="p-4 text-sm text-red-700">
            The offers tables are missing. Run <code className="text-xs">npm run db:migrate</code> (migration 0004_offers).
          </p>
        ) : (
          <OffersPanel
            items={setup.items}
            consenting={consenting}
            notAsked={notAsked}
            canAsk={!!(env.MARKETING_CONSENT_VERSION && env.NEWSLETTER_SECRET && env.MAIL_FROM)}
          />
        )}
      </Card>

      <Card title="Subscribers" flush>
        <SubscriberTable subscribers={subscribers} offers={offers} />
      </Card>
    </Shell>
  );
}

function Shell({ children, exportable, offersReady }: { children: React.ReactNode; exportable?: boolean; offersReady?: boolean }) {
  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Insights</h1>
          <p className="mt-1 text-sm text-zinc-500">The blog newsletter on drpbuildlab.com. Sign-up and sending happen on the site; the list lives in Resend.</p>
        </div>
        {exportable && (
          <a href="/api/insights/subscribers" className="btn-secondary" download>
            Export CSV
          </a>
        )}
      </div>
      <InsightsTabs active="overview" />
      {offersReady ? (
        <p className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700">
          <strong className="font-semibold">Two kinds of consent.</strong> Every subscriber gets new articles. Only those marked{" "}
          <em>Offers</em> agreed to offers, and offers only ever reach them. The export states each person’s consent in every row.
        </p>
      ) : (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong className="font-semibold">New-article emails only, for now.</strong> Offers stay locked until the lawyer approves the
          consent texts and the setup below is complete. Until then, don’t send subscribers offers or import this list into the CRM for
          marketing. The export says this in every row.
        </p>
      )}
      {children}
    </main>
  );
}
