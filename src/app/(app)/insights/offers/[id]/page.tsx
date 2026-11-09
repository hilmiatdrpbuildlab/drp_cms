import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireStaff } from "@/auth/server";
import type { Lang } from "@/lib/blog/contract";
import { getDb } from "@/lib/db";
import { activityByTag, activityLabel } from "@/lib/insights/activity";
import { articleActivity } from "@/lib/insights/activity-server";
import { FALLBACK_STRINGS, type OfferMailStrings } from "@/lib/insights/offers";
import { articleTags, consentingAudience, offersSetup, siteStrings } from "@/lib/insights/offers-server";
import { offers } from "@/lib/schema";

import { OfferEditor } from "./offer-editor";

export const metadata: Metadata = { title: "Offer" };

export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [offer] = await getDb().select().from(offers).where(eq(offers.id, id));
  if (!offer) notFound();

  const [setup, tags, audience, activity] = await Promise.all([
    offersSetup(),
    articleTags(),
    consentingAudience().catch(() => []),
    articleActivity().catch(() => null),
  ]);
  // Readers' likes, comments and email clicks per tag: a hint for which tags to target.
  const tagHints = Object.fromEntries((activity ? activityByTag(activity.articles) : []).map((t) => [t.tag, activityLabel(t)]));

  // The footer texts for the preview, per language the offer is written in; the English stand-in where the site has none yet.
  const langs = Object.keys(offer.versions) as Lang[];
  const footers: Partial<Record<Lang, OfferMailStrings & { live: boolean }>> = {};
  await Promise.all(
    langs.map(async (l) => {
      footers[l] = await siteStrings(l).then(
        (s) => ({ ...s, live: true }),
        () => ({ ...FALLBACK_STRINGS, live: false }),
      );
    }),
  );

  return (
    <main className="mx-auto max-w-7xl space-y-4 px-4 py-8">
      <Link href="/insights/offers" className="text-sm text-zinc-500 hover:text-zinc-900">
        ← Offers
      </Link>
      <OfferEditor
        offer={{
          id: offer.id,
          name: offer.name,
          partner: offer.partner,
          audienceTags: offer.audienceTags,
          versions: offer.versions,
          status: offer.status,
          results: offer.results,
        }}
        tags={tags.all}
        tagHints={tagHints}
        // Anonymous: only language and interests, no addresses, to count the audience while editing.
        audience={audience.map((a) => ({ lang: a.lang, tags: a.tags }))}
        footers={footers}
        canSend={setup.ready}
      />
    </main>
  );
}
