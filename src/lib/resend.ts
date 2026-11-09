import "server-only";

import { getEnv } from "@/lib/env";
import {
  langOfSegment,
  mergeSegmentContacts,
  parseBroadcastName,
  parseResendDate,
  type ResendContact,
  type Subscriber,
} from "@/lib/insights/newsletter";
import type { Lang } from "@/lib/blog/contract";
import { CONSENT_PROPS, OFFERS_TOPIC_NAME } from "@/lib/insights/offers";

/**
 * Resend's REST API, for the blog newsletter that drpbuildlab.com runs (see lib/insights/newsletter.ts).
 * The CMS only reads the list, and unsubscribes or deletes contacts in the blog segments; sign-up and
 * sending stay on the site.
 *
 * Resend allows 10 requests a second per team, shared with the site, so calls run a few at a time
 * and a 429 is waited out.
 */

const BASE = "https://api.resend.com";

export class ResendError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const resendConfigured = () => !!getEnv().RESEND_API_KEY;

async function call<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const key = getEnv().RESEND_API_KEY;
  if (!key) throw new ResendError("RESEND_API_KEY is not set", 0);
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(BASE + path, {
      method,
      headers: { authorization: `Bearer ${key}`, ...(body ? { "content-type": "application/json" } : {}), ...extraHeaders },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 429 && attempt < 4) {
      const wait = Math.min(3, Number(res.headers.get("retry-after")) || attempt);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      // No path in the message: contact paths contain the email address.
      const detail = (data as { message?: string } | null)?.message;
      throw new ResendError(`Resend answered ${res.status}${detail ? `: ${detail}` : ""}`, res.status);
    }
    return data as T;
  }
}

type Page<T> = { data: T[]; has_more: boolean };

/** Every item of a cursor-paginated list. */
async function listAll<T extends { id: string }>(path: string): Promise<T[]> {
  const out: T[] = [];
  let after = "";
  for (let i = 0; i < 500; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const page = await call<Page<T>>("GET", `${path}${sep}limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`);
    out.push(...page.data);
    if (!page.has_more || page.data.length === 0) break;
    after = page.data[page.data.length - 1].id;
  }
  return out;
}

/** Runs fn over items, at most `limit` at a time, keeping order. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function blogSegments(): Promise<{ id: string; lang: Lang }[]> {
  const all = await listAll<{ id: string; name: string }>("/segments");
  return all.flatMap((s) => {
    const lang = langOfSegment(s.name);
    return lang ? [{ id: s.id, lang }] : [];
  });
}

/** Everyone in a blog segment, subscribed or not. */
export async function getSubscribers(): Promise<Subscriber[]> {
  const segments = await blogSegments();
  const lists = await pool(segments, 3, async (s) => ({
    lang: s.lang,
    contacts: await listAll<ResendContact>(`/segments/${encodeURIComponent(s.id)}/contacts`),
  }));
  return mergeSegmentContacts(lists);
}

const contactPath = (email: string) => `/contacts/${encodeURIComponent(email)}`;

/**
 * The contact id if this address is in a blog segment, else null. The Resend team may hold other
 * contacts (the client zone, say), and the CMS must never touch those.
 */
export async function blogContactId(email: string): Promise<string | null> {
  let contact: { id: string };
  try {
    contact = await call<{ id: string }>("GET", contactPath(email));
  } catch (e) {
    if (e instanceof ResendError && e.status === 404) return null;
    throw e;
  }
  const segments = await listAll<{ id: string; name: string }>(`${contactPath(email)}/segments`);
  return segments.some((s) => langOfSegment(s.name)) ? contact.id : null;
}

/** Stops all newsletter emails, like the unsubscribe link does. The address stays, marked unsubscribed. */
export async function unsubscribeContact(email: string): Promise<void> {
  await call("PATCH", contactPath(email), { unsubscribed: true });
}

/** Erases the contact from Resend (GDPR erasure request). */
export async function deleteContact(email: string): Promise<void> {
  await call("DELETE", contactPath(email));
}

/* ── offers ──────────────────────────────────────────────────────────────── */

/** The offers topic's id, or null while nobody has opted in yet (the site creates it on the first opt-in). */
export async function offersTopicId(): Promise<string | null> {
  const all = await listAll<{ id: string; name: string; created_at: string }>("/topics");
  const mine = all.filter((t) => t.name === OFFERS_TOPIC_NAME).sort((a, b) => a.created_at.localeCompare(b.created_at));
  return mine[0]?.id ?? null;
}

export type ConsentState = {
  contactId: string;
  email: string;
  unsubscribed: boolean;
  optedIn: boolean;
  version: string | null;
  consentedAt: string | null;
  source: string | null;
};

/** One contact's offers consent as Resend has it, or null when the contact doesn't exist. */
export async function readConsent(emailOrId: string, topicId: string | null): Promise<ConsentState | null> {
  type Contact = { id: string; email: string; unsubscribed: boolean; properties?: Record<string, { value: unknown } | undefined> };
  let c: Contact;
  try {
    c = await call<Contact>("GET", `/contacts/${encodeURIComponent(emailOrId)}`);
  } catch (e) {
    if (e instanceof ResendError && e.status === 404) return null;
    throw e;
  }
  const topics = topicId ? await listAll<{ id: string; subscription: string }>(`/contacts/${encodeURIComponent(c.id)}/topics`) : [];
  const prop = (k: string) => {
    const v = c.properties?.[k]?.value;
    return typeof v === "string" && v ? v : null;
  };
  return {
    contactId: c.id,
    email: c.email.toLowerCase(),
    unsubscribed: c.unsubscribed === true,
    // A global unsubscribe stops offers too, whatever the topic says.
    optedIn: !c.unsubscribed && topics.some((t) => t.id === topicId && t.subscription === "opt_in"),
    version: prop(CONSENT_PROPS.version),
    consentedAt: parseResendDate(prop(CONSENT_PROPS.at))?.toISOString() ?? null,
    source: prop(CONSENT_PROPS.source),
  };
}

/** Is click (or any) tracking on for the domain the newsletter is sent from? null = domain not found. */
export async function clickTracking(fromAddress: string): Promise<boolean | null> {
  const domain = /@([^>\s]+)>?\s*$/.exec(fromAddress)?.[1]?.toLowerCase();
  if (!domain) return null;
  const all = await listAll<{ id: string; name: string }>("/domains");
  const d = all.find((x) => x.name.toLowerCase() === domain);
  if (!d) return null;
  const full = await call<{ click_tracking?: boolean }>("GET", `/domains/${encodeURIComponent(d.id)}`);
  return full.click_tracking === true;
}

export async function createSegment(name: string): Promise<string> {
  const r = await call<{ id: string }>("POST", "/segments", { name });
  return r.id;
}

export async function addToSegment(email: string, segmentId: string): Promise<void> {
  try {
    await call("POST", `${contactPath(email)}/segments/${encodeURIComponent(segmentId)}`);
  } catch (e) {
    if (!(e instanceof ResendError && e.status === 409)) throw e;
  }
}

/**
 * Creates a broadcast to one segment, limited to one topic, and sends it. It is created unsent first
 * and read back: if Resend did not keep the topic (which re-checks consent), it is deleted, not sent.
 */
export async function sendTopicBroadcast(b: {
  name: string;
  segmentId: string;
  topicId: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}): Promise<string> {
  const { id } = await call<{ id: string }>("POST", "/broadcasts", {
    name: b.name,
    segment_id: b.segmentId,
    topic_id: b.topicId,
    from: b.from,
    subject: b.subject,
    html: b.html,
    text: b.text,
  });
  const created = await call<{ topic_id?: string | null; segment_id?: string | null }>("GET", `/broadcasts/${encodeURIComponent(id)}`);
  if (created.topic_id !== b.topicId || created.segment_id !== b.segmentId) {
    await call("DELETE", `/broadcasts/${encodeURIComponent(id)}`).catch(() => undefined);
    throw new ResendError("Resend did not keep the offers topic on the broadcast; nothing was sent", 0);
  }
  await call("POST", `/broadcasts/${encodeURIComponent(id)}/send`, {});
  return id;
}

/** One transactional email (tests, consent requests). The idempotency key stops double sends on retry. */
export async function sendEmail(m: { from: string; to: string; subject: string; html: string; text: string; idempotencyKey: string }): Promise<void> {
  await call(
    "POST",
    "/emails",
    { from: m.from, to: [m.to], subject: m.subject, html: m.html, text: m.text },
    { "idempotency-key": m.idempotencyKey.slice(0, 256) },
  );
}

export type ArticleEmailStats = {
  broadcastId: string;
  slug: string;
  lang: Lang;
  sentAt: string | null;
  delivered: number;
  opened: number;
  clicked: number;
};

const RECIPIENT_TYPES = ["delivered", "opened", "clicked"] as const;
const STATS_TTL = 10 * 60 * 1000; // Resend caches these lists for up to 15 minutes anyway
let statsCache: { at: number; limit: number; value: Promise<ArticleEmailStats[]> } | null = null;

/**
 * Delivered / opened / clicked people for the most recent new-article emails. Resend has no totals,
 * so each count pages through that broadcast's recipients: kept to `limit` broadcasts and cached.
 */
export function getArticleEmailStats(limit = 15): Promise<ArticleEmailStats[]> {
  if (statsCache && statsCache.limit === limit && Date.now() - statsCache.at < STATS_TTL) return statsCache.value;
  const value = loadArticleEmailStats(limit);
  statsCache = { at: Date.now(), limit, value };
  value.catch(() => {
    if (statsCache?.value === value) statsCache = null;
  });
  return value;
}

async function loadArticleEmailStats(limit: number): Promise<ArticleEmailStats[]> {
  type Broadcast = { id: string; name: string | null; status: string; sent_at: string | null };
  const sent = (await listAll<Broadcast>("/broadcasts"))
    .flatMap((b) => {
      const parsed = parseBroadcastName(b.name);
      return parsed && b.status === "sent" ? [{ ...b, ...parsed, sentAt: parseResendDate(b.sent_at)?.toISOString() ?? null }] : [];
    })
    .sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""))
    .slice(0, limit);

  const jobs = sent.flatMap((b) => RECIPIENT_TYPES.map((type) => ({ b, type })));
  const counts = await pool(jobs, 4, async ({ b, type }) =>
    (await listAll<{ id: string }>(`/broadcasts/${encodeURIComponent(b.id)}/recipients?type=${type}`)).length,
  );

  return sent.map((b, i) => ({
    broadcastId: b.id,
    slug: b.slug,
    lang: b.lang,
    sentAt: b.sentAt,
    delivered: counts[i * 3],
    opened: counts[i * 3 + 1],
    clicked: counts[i * 3 + 2],
  }));
}
