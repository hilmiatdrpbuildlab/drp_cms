/**
 * The blog newsletter as drpbuildlab.com stores it in Resend, read back for the Insights page.
 *
 * The site owns sign-up (drp-buildlab-website: netlify/edge-functions/subscribe.js) and the
 * new-article emails (tools/concept/newsletter.js). Subscribers are Resend Contacts in ONE
 * Segment, "Blog newsletter". Their language is the contact property blog_lang, and a private
 * opt-out Topic "Blog newsletter (<lang>)" that article broadcasts are limited to. (Until
 * November 2026 it was one Segment per language with that same name, which the free plan's
 * 3 segments could not hold; those old segments are still read until they are gone.)
 * Each article email is a Broadcast named "blog:<slug>:<lang>". If the site changes those
 * names, change them here too.
 *
 * Pure module (no server/DB imports) so it can be unit-tested with `node --test`.
 */
import { LANGS, type Lang } from "../blog/contract.ts";

const SEGMENT_RE = /^Blog newsletter \(([a-z]{2})\)$/;
const BROADCAST_RE = /^blog:([a-z0-9]+(?:-[a-z0-9]+)*):([a-z]{2})$/;

const isLang = (s: string): s is Lang => (LANGS as readonly string[]).includes(s);

/** The one segment every blog subscriber is in. */
export const BLOG_SEGMENT = "Blog newsletter";
/** The contact property holding a subscriber's language. */
export const LANG_PROP = "blog_lang";

/** A blog_lang value as Resend returns it ({ value } or a bare string) -> a Lang, or null. */
export function langOfProperty(prop: unknown): Lang | null {
  const v = prop && typeof prop === "object" ? (prop as { value?: unknown }).value : prop;
  return typeof v === "string" && isLang(v) ? v : null;
}

/** "Blog newsletter (nl)" -> "nl"; any other segment -> null. Also names the language topics. */
export function langOfSegment(name: string | null | undefined): Lang | null {
  const m = SEGMENT_RE.exec(name ?? "");
  return m && isLang(m[1]) ? m[1] : null;
}

/** "blog:my-article:nl" -> { slug, lang }; any other broadcast -> null. */
export function parseBroadcastName(name: string | null | undefined): { slug: string; lang: Lang } | null {
  const m = BROADCAST_RE.exec(name ?? "");
  return m && isLang(m[2]) ? { slug: m[1], lang: m[2] } : null;
}

/** Resend writes timestamps as "2026-10-06 23:47:56.678+00", which Date can't always parse. */
export function parseResendDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const iso = s.trim().replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A contact as Resend lists it. */
export type ResendContact = {
  id: string;
  email: string;
  created_at?: string | null;
  unsubscribed?: boolean;
};

/** One subscriber, serialisable for client components. */
export type Subscriber = {
  id: string;
  email: string;
  /** Normally one (blog_lang). Empty for a contact in the blog segment without a language. */
  langs: Lang[];
  unsubscribed: boolean;
  /** When the Resend contact was created (first confirmed sign-up), ISO 8601. */
  createdAt: string | null;
};

/**
 * The contacts of each blog segment, merged into one list, newest first. A list with lang null
 * (the "Blog newsletter" segment) takes each contact's language from `langOf` (its blog_lang);
 * a contact without one is listed with no language.
 */
export function mergeSegmentContacts(
  segments: { lang: Lang | null; contacts: ResendContact[] }[],
  langOf: (contactId: string) => Lang | null = () => null,
): Subscriber[] {
  const byId = new Map<string, Subscriber>();
  for (const { lang: segLang, contacts } of segments) {
    for (const c of contacts) {
      const lang = segLang ?? langOf(c.id);
      const found = byId.get(c.id);
      if (found) {
        if (lang && !found.langs.includes(lang)) found.langs.push(lang);
        continue;
      }
      byId.set(c.id, {
        id: c.id,
        email: c.email.toLowerCase(),
        langs: lang ? [lang] : [],
        unsubscribed: c.unsubscribed === true,
        createdAt: parseResendDate(c.created_at)?.toISOString() ?? null,
      });
    }
  }
  return [...byId.values()].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

const monthKey = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit" }).format(d).slice(0, 7);

export type Summary = {
  active: number;
  unsubscribed: number;
  newLast30Days: number;
  /** Active subscribers per language, most first. */
  byLang: { lang: Lang; count: number }[];
  /** New subscribers per month (Europe/Brussels), oldest first, the last `months` months. */
  byMonth: { month: string; count: number }[];
};

export function summarize(subs: Subscriber[], now = new Date(), months = 12): Summary {
  const active = subs.filter((s) => !s.unsubscribed);
  const since = now.getTime() - 30 * 24 * 60 * 60 * 1000;

  const langCounts = new Map<Lang, number>();
  for (const s of active) for (const l of s.langs) langCounts.set(l, (langCounts.get(l) ?? 0) + 1);

  const monthKeys: string[] = [];
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15));
  for (let i = months - 1; i >= 0; i--) {
    monthKeys.push(monthKey(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - i, 15))));
  }
  const monthCounts = new Map(monthKeys.map((k) => [k, 0]));
  for (const s of subs) {
    if (!s.createdAt) continue;
    const k = monthKey(new Date(s.createdAt));
    if (monthCounts.has(k)) monthCounts.set(k, monthCounts.get(k)! + 1);
  }

  return {
    active: active.length,
    unsubscribed: subs.length - active.length,
    newLast30Days: subs.filter((s) => s.createdAt && new Date(s.createdAt).getTime() >= since).length,
    byLang: [...langCounts].map(([lang, count]) => ({ lang, count })).sort((a, b) => b.count - a.count || a.lang.localeCompare(b.lang)),
    byMonth: monthKeys.map((month) => ({ month, count: monthCounts.get(month)! })),
  };
}

/**
 * What every subscriber agreed to, per the site's form and privacy policy. It goes into the export
 * so nobody downstream (a CRM import, say) mistakes the list for marketing consent.
 */
export const CONSENT_SCOPE = "Blog newsletter: new-article emails only (consent, art. 6(1)(a) GDPR). Not marketing.";
export const OFFERS_SCOPE = "Blog newsletter + offers from DRP BuildLab and partners, matched to clicked articles (separate consent, art. 6(1)(a) GDPR).";

/** One CSV cell: quoted when needed, and never read as a formula by a spreadsheet. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Offers consent (Phase 2) per email, when known. */
export type OfferConsentInfo = { optedIn: boolean; version: string | null; consentedAt: string | null; interests: string[] };

export function toCsv(subs: Subscriber[], offers: Map<string, OfferConsentInfo> = new Map()): string {
  const rows = [
    ["email", "language", "status", "first_subscribed", "consent", "offers_consent", "offers_consent_version", "offers_consent_at", "interests"],
    ...subs.map((s) => {
      const o = offers.get(s.email);
      const offersOk = !!o?.optedIn && !s.unsubscribed;
      return [
        s.email,
        s.langs.join(" "),
        s.unsubscribed ? "unsubscribed" : "subscribed",
        s.createdAt ?? "",
        offersOk ? OFFERS_SCOPE : CONSENT_SCOPE,
        offersOk ? "yes" : "no",
        offersOk ? (o.version ?? "") : "",
        offersOk ? (o.consentedAt ?? "") : "",
        offersOk ? o.interests.join(" ") : "",
      ];
    }),
  ];
  // CRLF (RFC 4180) and a BOM, so Excel opens it as UTF-8.
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
