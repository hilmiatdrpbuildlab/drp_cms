/**
 * Offers (Phase 2 of the blog newsletter): consent, interests, and the emails.
 * The contract with drpbuildlab.com is docs/offers-consent-contract.md. Change both together.
 *
 * Pure module (no server/DB imports) so it can be unit-tested with `node --test`.
 */
import { z } from "zod";

import type { Lang } from "../blog/contract.ts";

export const OFFERS_TOPIC_NAME = "Offers from DRP BuildLab and partners";
export const CONSENT_PROPS = {
  version: "offers_consent_version",
  at: "offers_consent_at",
  source: "offers_consent_source",
} as const;

/** The market each language's emails link to: the same choice as the site's LANG_HOME. */
export const LANG_HOME: Record<Lang, string> = {
  nl: "be", fr: "fr", de: "de", it: "it", es: "es", pt: "br", pl: "pl", en: "ie", id: "id", ja: "jp", ar: "ae", af: "za-af",
};
export const marketPrefix = (lang: Lang) => LANG_HOME[lang].replace("-", "/");
const RTL: Lang[] = ["ar"];

/* ── staff-written offer ───────────────────────────────────────────────── */

const httpsUrl = z
  .string()
  .trim()
  .url("Button link must be a full URL")
  .refine((u) => u.startsWith("https://"), "Button link must start with https://");

/** One language of an offer email, as staff write it. */
export const offerVersionSchema = z.object({
  subject: z.string().trim().min(3, "Subject: at least 3 characters").max(150),
  heading: z.string().trim().min(3, "Heading: at least 3 characters").max(150),
  /** Plain text. A blank line starts a new paragraph. */
  body: z.string().trim().min(20, "Text: at least 20 characters").max(5000),
  buttonLabel: z.string().trim().min(2, "Button text is required").max(60),
  buttonUrl: httpsUrl,
});
export type OfferVersion = z.infer<typeof offerVersionSchema>;

/* ── strings from the site ─────────────────────────────────────────────── */

export const OFFER_MAIL_KEYS = ["osubj", "ohead", "obody", "obtn", "ovalid", "oignore", "ppartner", "pfoot", "punsub"] as const;
export type OfferMailStrings = Record<(typeof OFFER_MAIL_KEYS)[number], string>;

/** English stand-ins, only for test sends while the site's /blog/offers/ page is not live yet. */
export const FALLBACK_STRINGS: OfferMailStrings = {
  osubj: "Would you also like offers from DRP BuildLab?",
  ohead: "Offers, only if you want them",
  obody: "You receive our new blog articles. We'd also like to send you occasional offers from DRP BuildLab and selected partners. That only happens if you agree on the page behind this button.",
  obtn: "Choose whether you want offers",
  ovalid: "This link is valid for 30 days.",
  oignore: "Not interested? Then ignore this email; you will keep getting our articles and nothing else.",
  ppartner: "An offer from our partner",
  pfoot: "You receive this email because you agreed to receive offers from DRP BuildLab and its partners.",
  punsub: "Unsubscribe from offers",
};

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** The #mail strings of a localized /blog/offers/ page. Throws when one is missing. */
export function offerMailStrings(html: string): OfferMailStrings {
  const block = /<div id="mail" hidden(?:="")?>([\s\S]*?)<\/div>/.exec(html)?.[1];
  if (!block) throw new Error("no #mail block in the offers page");
  const s: Partial<OfferMailStrings> = {};
  for (const [, k, v] of block.matchAll(/<span data-k="([a-z]+)">([\s\S]*?)<\/span>/g)) {
    if ((OFFER_MAIL_KEYS as readonly string[]).includes(k)) s[k as keyof OfferMailStrings] = decode(v);
  }
  const missing = OFFER_MAIL_KEYS.filter((k) => !s[k]);
  if (missing.length) throw new Error(`offers page is missing mail strings: ${missing.join(", ")}`);
  return s as OfferMailStrings;
}

/* ── emails ────────────────────────────────────────────────────────────── */

/** Filled in by Resend per recipient: its preference page (per topic, or everything). */
export const UNSUBSCRIBE = "{{{RESEND_UNSUBSCRIBE_URL}}}";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The site's email layout (netlify/shared/newsletter.mjs), so offers look like the newsletter. */
function layout({ lang, title, inner, foot, banner }: { lang: Lang; title: string; inner: string; foot?: string; banner?: string }) {
  const dir = RTL.includes(lang) ? "rtl" : "ltr";
  const align = dir === "rtl" ? "right" : "left";
  return `<!doctype html>
<html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f1f2f6;color:#0b0b0c;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f2f6"><tr><td align="center" style="padding:32px 16px">
${banner ? `<p style="max-width:528px;margin:0 auto 16px;padding:12px 16px;background:#fff3cd;border-radius:10px;font-size:14px;line-height:1.5;color:#5c4400;text-align:left" dir="ltr">${esc(banner)}</p>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="max-width:560px;background:#ffffff;border-radius:16px;text-align:${align}">
<tr><td style="padding:28px 32px 0;font-weight:800;font-size:15px;letter-spacing:.04em" dir="ltr" align="${align}"><span style="color:#0b0b0c">DRP</span> <span style="color:#1f5eff">BUILDLAB</span></td></tr>
${inner}
</table>
${foot ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="max-width:560px;text-align:${align}"><tr><td style="padding:18px 32px;font-size:12.5px;line-height:1.6;color:#5a5d67">${foot}</td></tr></table>` : ""}
</td></tr></table>
</body></html>`;
}

const button = (href: string, label: string) =>
  `<a href="${esc(href)}" style="display:inline-block;background:#1f5eff;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 24px;border-radius:99px">${esc(label)}</a>`;

const paragraphs = (body: string) =>
  body
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

export type Email = { subject: string; html: string; text: string };

/** An offer, in one language. `partner` names the company behind it, if it is not DRP BuildLab's own. */
export function offerEmail({ s, lang, v, partner, banner }: { s: OfferMailStrings; lang: Lang; v: OfferVersion; partner?: string; banner?: string }): Email {
  const paras = paragraphs(v.body);
  const partnerLine = partner?.trim() ? `${s.ppartner}: ${partner.trim()}` : "";
  const inner = `${partnerLine ? `<tr><td style="padding:24px 32px 0;font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#1f5eff">${esc(partnerLine)}</td></tr>` : ""}
<tr><td style="padding:${partnerLine ? 14 : 24}px 32px 0"><h1 style="margin:0;font-size:26px;line-height:1.25">${esc(v.heading)}</h1></td></tr>
${paras.map((p) => `<tr><td style="padding:12px 32px 0;font-size:16px;line-height:1.6;color:#1d2230">${esc(p).replace(/\n/g, "<br>")}</td></tr>`).join("\n")}
<tr><td style="padding:24px 32px 32px">${button(v.buttonUrl, v.buttonLabel)}</td></tr>`;
  const foot = `${esc(s.pfoot)}<br><a href="${UNSUBSCRIBE}" style="color:#5a5d67">${esc(s.punsub)}</a>`;
  return {
    subject: v.subject,
    html: layout({ lang, title: v.subject, inner, foot, banner }),
    text: [
      ...(banner ? [banner, ""] : []),
      ...(partnerLine ? [partnerLine, ""] : []),
      v.heading,
      "",
      ...paras.flatMap((p) => [p, ""]),
      `${v.buttonLabel}: ${v.buttonUrl}`,
      "",
      "—",
      s.pfoot,
      `${s.punsub}: ${UNSUBSCRIBE}`,
    ].join("\n"),
  };
}

/** Asks a current subscriber whether they also want offers. The link leads to the site's consent page. */
export function consentRequestEmail({ s, lang, link }: { s: OfferMailStrings; lang: Lang; link: string }): Email {
  const inner = `<tr><td style="padding:24px 32px 0"><h1 style="margin:0;font-size:26px;line-height:1.2">${esc(s.ohead)}</h1></td></tr>
<tr><td style="padding:14px 32px 0;font-size:16px;line-height:1.6">${esc(s.obody)}</td></tr>
<tr><td style="padding:24px 32px 0">${button(link, s.obtn)}</td></tr>
<tr><td style="padding:20px 32px 0;font-size:14px;line-height:1.6;color:#5a5d67">${esc(s.ovalid)}</td></tr>
<tr><td style="padding:12px 32px 32px;font-size:14px;line-height:1.6;color:#5a5d67">${esc(s.oignore)}</td></tr>`;
  return {
    subject: s.osubj,
    html: layout({ lang, title: s.osubj, inner }),
    text: [s.ohead, "", s.obody, "", `${s.obtn}: ${link}`, "", s.ovalid, s.oignore].join("\n"),
  };
}

/* ── interests and audience ────────────────────────────────────────────── */

const RESERVED_SLUGS = new Set(["subscribe", "offers"]);

/** The blog article a clicked link points to, on the site (any market), or null. */
export function slugFromLink(link: string, siteOrigin = "https://drpbuildlab.com"): string | null {
  let u: URL;
  let site: URL;
  try {
    u = new URL(link);
    site = new URL(siteOrigin);
  } catch {
    return null;
  }
  const host = site.hostname.replace(/^www\./, "");
  if (u.hostname !== host && u.hostname !== `www.${host}`) return null;
  const m = /\/blog\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec(u.pathname);
  return m && !RESERVED_SLUGS.has(m[1]) ? m[1] : null;
}

/** A subscriber with offers consent, as targeting sees them. */
export type AudienceMember = { email: string; lang: Lang; tags: string[] };

const norm = (t: string) => t.trim().toLowerCase();

/** Interest tags of one subscriber: the tags of the articles they clicked, most clicked first. */
export function interestTags(clicks: { slug: string; clicks: number }[], tagsBySlug: Map<string, string[]>): string[] {
  const score = new Map<string, number>();
  for (const c of clicks) for (const t of tagsBySlug.get(c.slug) ?? []) score.set(norm(t), (score.get(norm(t)) ?? 0) + c.clicks);
  return [...score].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

/** Who gets an offer, per language: no tags means every consenting subscriber; otherwise anyone with one of the tags. */
export function audienceByLang(members: AudienceMember[], audienceTags: string[]): Map<Lang, string[]> {
  const want = new Set(audienceTags.map(norm));
  const out = new Map<Lang, string[]>();
  for (const m of members) {
    if (want.size && !m.tags.some((t) => want.has(norm(t)))) continue;
    out.set(m.lang, [...(out.get(m.lang) ?? []), m.email]);
  }
  return out;
}
