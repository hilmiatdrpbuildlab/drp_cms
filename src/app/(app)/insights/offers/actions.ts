"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getStaff } from "@/auth/server";
import { LANGS, type Lang } from "@/lib/blog/contract";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { seal } from "@/lib/insights/crypto";
import {
  audienceByLang,
  consentRequestEmail,
  FALLBACK_STRINGS,
  LANG_HOME,
  marketPrefix,
  offerEmail,
  offerVersionSchema,
  type OfferMailStrings,
} from "@/lib/insights/offers";
import { consentingAudience, offersSetup, resyncAllConsents, siteStrings } from "@/lib/insights/offers-server";
import { addToSegment, createSegment, getSubscribers, ResendError, sendEmail, sendTopicBroadcast } from "@/lib/resend";
import { consentRequests, offers, type OfferResult } from "@/lib/schema";

import type { ActionResult } from "../../blog/actions";

const UNAUTHENTICATED = { ok: false as const, error: "Your session ended. Sign in again in another tab, then retry." };
const message = (e: unknown) => (e instanceof ResendError || e instanceof Error ? e.message : "Something went wrong.");

export async function createOffer() {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  const [row] = await getDb()
    .insert(offers)
    .values({ name: "Untitled offer", createdBy: staff.email, updatedBy: staff.email })
    .returning({ id: offers.id });
  redirect(`/insights/offers/${row.id}`);
}

const saveInput = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1, "Name is required").max(120),
  partner: z.string().trim().max(120),
  audienceTags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(30),
  /** Languages being written; a half-written one is saved as is and checked before sending. */
  versions: z.partialRecord(z.enum(LANGS), z.object({ subject: z.string(), heading: z.string(), body: z.string(), buttonLabel: z.string(), buttonUrl: z.string() })),
});
export type SaveOfferInput = z.input<typeof saveInput>;

export async function saveOffer(raw: SaveOfferInput): Promise<ActionResult> {
  const staff = await getStaff();
  if (!staff) return UNAUTHENTICATED;
  const parsed = saveInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Some fields are invalid.", errors: parsed.error.issues.map((i) => i.message) };
  const { id, ...fields } = parsed.data;
  const updated = await getDb()
    .update(offers)
    .set({ ...fields, updatedBy: staff.email, updatedAt: new Date() })
    .where(and(eq(offers.id, id), eq(offers.status, "draft")))
    .returning({ id: offers.id });
  if (!updated.length) return { ok: false, error: "This offer was sent (or deleted) and can no longer be changed." };
  revalidatePath(`/insights/offers/${id}`);
  revalidatePath("/insights/offers");
  return { ok: true };
}

export async function deleteOffer(id: string): Promise<ActionResult> {
  const staff = await getStaff();
  if (!staff) return UNAUTHENTICATED;
  await getDb().delete(offers).where(and(eq(offers.id, id), eq(offers.status, "draft")));
  revalidatePath("/insights/offers");
  redirect("/insights/offers");
}

/** Every saved language, validated: the versions that will actually be sent. */
function validVersions(versions: Partial<Record<Lang, unknown>>) {
  const out: [Lang, z.infer<typeof offerVersionSchema>][] = [];
  const errors: string[] = [];
  for (const [lang, v] of Object.entries(versions) as [Lang, unknown][]) {
    const p = offerVersionSchema.safeParse(v);
    if (p.success) out.push([lang, p.data]);
    else errors.push(...p.error.issues.map((i) => `${lang.toUpperCase()}: ${i.message}`));
  }
  return { out, errors };
}

/** Sends one language of the saved offer to the signed-in staff member only. */
export async function sendOfferTest(id: string, lang: Lang): Promise<ActionResult<{ to: string }>> {
  const staff = await getStaff();
  if (!staff) return UNAUTHENTICATED;
  const from = getEnv().MAIL_FROM;
  if (!from) return { ok: false, error: "Set MAIL_FROM first." };
  const [offer] = await getDb().select().from(offers).where(eq(offers.id, id));
  const v = offerVersionSchema.safeParse(offer?.versions[lang]);
  if (!offer || !v.success) return { ok: false, error: `Save a complete ${lang.toUpperCase()} version first.`, errors: v.error?.issues.map((i) => i.message) };

  let s: OfferMailStrings = FALLBACK_STRINGS;
  let note = "";
  try {
    s = await siteStrings(lang);
  } catch {
    note = " The footer is the English stand-in: the site's offers page is not live yet.";
  }
  const m = offerEmail({ s, lang, v: v.data, partner: offer.partner, banner: `Test of "${offer.name}" (${lang.toUpperCase()}). Only you received this.${note}` });
  try {
    await sendEmail({
      from,
      to: staff.email,
      subject: `[Test] ${m.subject}`,
      html: m.html.split("{{{RESEND_UNSUBSCRIBE_URL}}}").join("#"),
      text: m.text.split("{{{RESEND_UNSUBSCRIBE_URL}}}").join("(unsubscribe link)"),
      idempotencyKey: `offer-test-${id}-${lang}-${Date.now()}`,
    });
  } catch (e) {
    return { ok: false, error: message(e) };
  }
  return { ok: true, to: staff.email };
}

/**
 * Sends the offer: per language, a segment of the chosen consenting subscribers and a broadcast
 * limited to the offers topic (Resend re-checks consent). Languages without a version are skipped.
 * If it stops halfway, running it again sends only the languages not in `results` yet.
 */
export async function sendOffer(id: string): Promise<ActionResult<{ sent: OfferResult[] }>> {
  const staff = await getStaff();
  if (!staff) return UNAUTHENTICATED;
  const env = getEnv();
  const setup = await offersSetup();
  if (!setup.ready || !setup.topicId || !env.MAIL_FROM) {
    return { ok: false, error: "Offers can't be sent yet: see the checklist on the Insights page (lawyer approval, sender, offers topic)." };
  }

  const db = getDb();
  const [offer] = await db.select().from(offers).where(eq(offers.id, id));
  if (!offer) return { ok: false, error: "This offer no longer exists." };
  if (offer.status === "sent") return { ok: false, error: "This offer was already sent." };
  const { out: versions, errors } = validVersions(offer.versions);
  if (errors.length) return { ok: false, error: "Some languages are incomplete.", errors };

  const audience = audienceByLang(await consentingAudience(), offer.audienceTags);
  const done = new Set(offer.results.map((r) => r.lang));
  const todo = versions.filter(([lang]) => !done.has(lang) && (audience.get(lang)?.length ?? 0) > 0);
  if (!todo.length) return { ok: false, error: "Nobody to send to: no consenting subscriber matches in the written languages." };

  // Texts first, for every language: a missing page stops before anything is sent.
  const strings = new Map<Lang, OfferMailStrings>();
  try {
    for (const [lang] of todo) strings.set(lang, await siteStrings(lang));
  } catch (e) {
    return { ok: false, error: `The site's offers page is not available: ${message(e)}` };
  }

  // Claim the offer, so two people can't send it at the same time.
  const claimed = await db
    .update(offers)
    .set({ status: "sending", sentBy: staff.email, updatedAt: new Date() })
    .where(and(eq(offers.id, id), eq(offers.status, offer.status)))
    .returning({ id: offers.id });
  if (!claimed.length) return { ok: false, error: "Someone else is sending this offer right now." };

  const results = [...offer.results];
  try {
    for (const [lang, v] of todo) {
      const recipients = audience.get(lang)!;
      const segmentId = await createSegment(`Offer ${id.slice(0, 8)} (${lang})`);
      for (const email of recipients) await addToSegment(email, segmentId);
      const m = offerEmail({ s: strings.get(lang)!, lang, v, partner: offer.partner });
      const broadcastId = await sendTopicBroadcast({
        name: `offer:${id}:${lang}`,
        segmentId,
        topicId: setup.topicId,
        from: env.MAIL_FROM,
        subject: m.subject,
        html: m.html,
        text: m.text,
      });
      results.push({ lang, recipients: recipients.length, segmentId, broadcastId, sentAt: new Date().toISOString() });
      await db.update(offers).set({ results }).where(eq(offers.id, id));
      console.info(`[offers] ${staff.email} sent offer ${id} (${lang}) to ${recipients.length}`);
    }
  } catch (e) {
    console.error(`[offers] sending ${id} failed`, message(e));
    await db.update(offers).set({ results }).where(eq(offers.id, id));
    revalidatePath(`/insights/offers/${id}`);
    return { ok: false, error: `Sending stopped: ${message(e)}. Sent so far: ${results.map((r) => r.lang.toUpperCase()).join(", ") || "none"}. Send again to continue.` };
  }

  await db.update(offers).set({ status: "sent", results, sentAt: new Date() }).where(eq(offers.id, id));
  revalidatePath(`/insights/offers/${id}`);
  revalidatePath("/insights/offers");
  return { ok: true, sent: results };
}

/* ── consent ──────────────────────────────────────────────────────────── */

export async function resyncConsents(): Promise<ActionResult<{ checked: number; optedIn: number }>> {
  const staff = await getStaff();
  if (!staff) return UNAUTHENTICATED;
  try {
    const r = await resyncAllConsents();
    revalidatePath("/insights");
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: message(e) };
  }
}

/**
 * Emails every active subscriber without offers consent who was never asked, once, with a link
 * to the site's consent page. Nothing changes for anyone who ignores it.
 */
export async function sendConsentRequests(): Promise<ActionResult<{ sent: number; failed: number }>> {
  const staff = await getStaff();
  if (!staff) return UNAUTHENTICATED;
  const env = getEnv();
  if (!env.MARKETING_CONSENT_VERSION || !env.NEWSLETTER_SECRET || !env.MAIL_FROM) {
    return { ok: false, error: "Needs MARKETING_CONSENT_VERSION (lawyer approval), NEWSLETTER_SECRET and MAIL_FROM." };
  }
  const db = getDb();
  const [subs, asked, audience] = await Promise.all([
    getSubscribers(),
    db.select({ email: consentRequests.email }).from(consentRequests),
    consentingAudience(),
  ]);
  const skip = new Set([...asked.map((a) => a.email), ...audience.map((a) => a.email)]);
  const todo = subs.filter((s) => !s.unsubscribed && !skip.has(s.email));

  let sent = 0;
  let failed = 0;
  for (const s of todo) {
    const lang = s.langs[0];
    try {
      const strings = await siteStrings(lang);
      const token = await seal({ e: s.email, l: lang, m: LANG_HOME[lang], t: Date.now(), p: "offers" }, env.NEWSLETTER_SECRET);
      const link = `${env.SITE_ORIGIN}/${marketPrefix(lang)}/blog/offers/#t=${token}`;
      const m = consentRequestEmail({ s: strings, lang, link });
      await sendEmail({ from: env.MAIL_FROM, to: s.email, ...m, idempotencyKey: `offers-consent-request-${s.id}` });
      await db.insert(consentRequests).values({ email: s.email, sentBy: staff.email }).onConflictDoNothing();
      sent++;
    } catch (e) {
      failed++;
      console.error(`[offers] consent request to contact ${s.id} failed`, message(e));
    }
  }
  console.info(`[offers] ${staff.email} sent ${sent} consent requests (${failed} failed)`);
  revalidatePath("/insights");
  return { ok: true, sent, failed };
}
