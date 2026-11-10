import "server-only";

import { eq, inArray, sql } from "drizzle-orm";

import type { Lang } from "@/lib/blog/contract";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { clickTracking, getSubscribers, offersTopicId, readConsent, resendConfigured, type ConsentState } from "@/lib/resend";
import { articleClicks, offerConsents, posts } from "@/lib/schema";

import { interestTags, marketPrefix, offerMailStrings, type AudienceMember, type OfferMailStrings } from "./offers";

/* ── the consent copy ────────────────────────────────────────────────── */

async function store(state: ConsentState | null, key: { email?: string; contactId?: string }) {
  const db = getDb();
  if (!state) {
    // The contact is gone from Resend: forget everything about it.
    const rows = key.email
      ? [{ email: key.email }]
      : key.contactId
        ? await db.select({ email: offerConsents.email }).from(offerConsents).where(eq(offerConsents.contactId, key.contactId))
        : [];
    const emails = rows.map((r) => r.email);
    if (emails.length) {
      await db.delete(offerConsents).where(inArray(offerConsents.email, emails));
      await db.delete(articleClicks).where(inArray(articleClicks.email, emails));
    }
    return;
  }
  const row = {
    email: state.email,
    contactId: state.contactId,
    optedIn: state.optedIn,
    version: state.version,
    consentedAt: state.consentedAt ? new Date(state.consentedAt) : null,
    source: state.source,
    syncedAt: new Date(),
  };
  await db.insert(offerConsents).values(row).onConflictDoUpdate({ target: offerConsents.email, set: row });
  // No consent, no profile.
  if (!state.optedIn) await db.delete(articleClicks).where(eq(articleClicks.email, state.email));
}

/** Re-reads one contact from Resend and updates the copy. Called by the webhook. */
export async function syncConsent(key: { email?: string; contactId?: string }, topicId?: string | null) {
  const id = key.email ?? key.contactId;
  if (!id) return null;
  const topic = topicId === undefined ? await offersTopicId() : topicId;
  const state = await readConsent(id, topic);
  await store(state, key);
  return state;
}

/** Re-reads every subscriber's consent from Resend (one or two calls each), and drops rows of contacts that are gone. */
export async function resyncAllConsents(): Promise<{ checked: number; optedIn: number }> {
  const [subs, topic] = await Promise.all([getSubscribers(), offersTopicId()]);
  let optedIn = 0;
  for (let i = 0; i < subs.length; i += 3) {
    const batch = subs.slice(i, i + 3);
    const states = await Promise.all(batch.map((s) => readConsent(s.id, topic)));
    for (const [j, st] of states.entries()) {
      await store(st, { email: batch[j].email });
      if (st?.optedIn) optedIn++;
    }
  }
  const known = new Set(subs.map((s) => s.email));
  const db = getDb();
  const stale = (await db.select({ email: offerConsents.email }).from(offerConsents)).map((r) => r.email).filter((e) => !known.has(e));
  if (stale.length) {
    await db.delete(offerConsents).where(inArray(offerConsents.email, stale));
    await db.delete(articleClicks).where(inArray(articleClicks.email, stale));
  }
  return { checked: subs.length, optedIn };
}

/** Counts one click on a blog article, only for someone with offers consent. */
export async function recordClick(email: string, slug: string): Promise<boolean> {
  const db = getDb();
  let [row] = await db.select({ optedIn: offerConsents.optedIn }).from(offerConsents).where(eq(offerConsents.email, email));
  if (!row) {
    const st = await syncConsent({ email });
    row = { optedIn: !!st?.optedIn };
  }
  if (!row.optedIn) return false;
  await db
    .insert(articleClicks)
    .values({ email, slug })
    .onConflictDoUpdate({
      target: [articleClicks.email, articleClicks.slug],
      set: { clicks: sql`${articleClicks.clicks} + 1`, lastAt: sql`now()` },
    });
  return true;
}

/** Forgets one address entirely (after a delete in Insights). */
export async function forget(email: string) {
  await store(null, { email });
}

/* ── interests and audience ────────────────────────────────────────────── */

/** Every tag used on an article, and each slug's tags (current and last published slug). */
export async function articleTags(): Promise<{ all: string[]; bySlug: Map<string, string[]> }> {
  const rows = await getDb().select({ slug: posts.slug, publishedSlug: posts.publishedSlug, tags: posts.tags }).from(posts);
  const bySlug = new Map<string, string[]>();
  const all = new Set<string>();
  for (const r of rows) {
    bySlug.set(r.slug, r.tags);
    if (r.publishedSlug) bySlug.set(r.publishedSlug, r.tags);
    r.tags.forEach((t) => all.add(t.trim().toLowerCase()));
  }
  return { all: [...all].sort(), bySlug };
}

export type ConsentRow = { optedIn: boolean; version: string | null; consentedAt: string | null; source: string | null };

/** The consent copy and the interest tags of everyone in it, keyed by email. */
export async function consentsAndInterests(): Promise<{ consents: Map<string, ConsentRow>; interests: Map<string, string[]> }> {
  const db = getDb();
  const [rows, clicks, tags] = await Promise.all([db.select().from(offerConsents), db.select().from(articleClicks), articleTags()]);
  const consents = new Map(
    rows.map((r) => [r.email, { optedIn: r.optedIn, version: r.version, consentedAt: r.consentedAt?.toISOString() ?? null, source: r.source }]),
  );
  const byEmail = new Map<string, { slug: string; clicks: number }[]>();
  for (const c of clicks) byEmail.set(c.email, [...(byEmail.get(c.email) ?? []), c]);
  const interests = new Map([...byEmail].map(([email, cs]) => [email, interestTags(cs, tags.bySlug)]));
  return { consents, interests };
}

/** Active subscribers with offers consent, with their language and interests. */
export async function consentingAudience(): Promise<AudienceMember[]> {
  const [subs, { consents, interests }] = await Promise.all([getSubscribers(), consentsAndInterests()]);
  return subs
    .filter((s) => !s.unsubscribed && consents.get(s.email)?.optedIn)
    .map((s) => ({ email: s.email, lang: s.langs[0] ?? "en", tags: interests.get(s.email) ?? [] }));
}

/* ── texts from the site ─────────────────────────────────────────────── */

const stringsCache = new Map<Lang, { at: number; s: OfferMailStrings }>();

/** The translated email texts from drpbuildlab.com/<market>/blog/offers/. Throws if the page or a string is missing. */
export async function siteStrings(lang: Lang): Promise<OfferMailStrings> {
  const hit = stringsCache.get(lang);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.s;
  const url = `${getEnv().SITE_ORIGIN}/${marketPrefix(lang)}/blog/offers/`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const s = offerMailStrings(await res.text());
  stringsCache.set(lang, { at: Date.now(), s });
  return s;
}

/* ── setup checklist ───────────────────────────────────────────────────── */

export type SetupItem = { label: string; ok: boolean | null; hint: string };

/** What Phase 2 still needs before it can send. `ready` = nothing blocking. */
export async function offersSetup(): Promise<{ items: SetupItem[]; ready: boolean; topicId: string | null }> {
  const env = getEnv();
  const topicId = resendConfigured() ? await offersTopicId().catch(() => null) : null;
  const tracking = env.MAIL_FROM && resendConfigured() ? await clickTracking(env.MAIL_FROM).catch(() => null) : null;
  const items: SetupItem[] = [
    {
      label: "Consent text approved by the lawyer",
      ok: !!env.MARKETING_CONSENT_VERSION,
      hint: env.MARKETING_CONSENT_VERSION
        ? `Version ${env.MARKETING_CONSENT_VERSION}`
        : "Set MARKETING_CONSENT_VERSION (here and on the site) once the lawyer approves the texts.",
    },
    { label: "Sender address", ok: !!env.MAIL_FROM, hint: env.MAIL_FROM ?? "Set MAIL_FROM, the same as the site's." },
    {
      label: "Shared token secret",
      ok: !!env.NEWSLETTER_SECRET,
      hint: "NEWSLETTER_SECRET, the same value as the site's. Needed to ask current subscribers.",
    },
    {
      label: "Resend webhook",
      ok: !!env.RESEND_WEBHOOK_SECRET,
      hint: "Keeps consent and clicks up to date. See README.md, Offers.",
    },
    {
      label: "Click tracking on the sending domain",
      ok: tracking,
      hint: tracking === null ? "Couldn't check (MAIL_FROM unset, or its domain is not in Resend)." : "Resend → Domains → Tracking.",
    },
    {
      label: "Offers topic in Resend",
      ok: !!topicId,
      hint: topicId ? "Exists." : "Created by the site on the first opt-in. Until then nobody can receive offers.",
    },
  ];
  const ready = !!env.MARKETING_CONSENT_VERSION && !!env.MAIL_FROM && !!topicId;
  return { items, ready, topicId };
}
