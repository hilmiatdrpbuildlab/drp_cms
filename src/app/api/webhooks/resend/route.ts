import { getEnv } from "@/lib/env";
import { verifySvix } from "@/lib/insights/crypto";
import { slugFromLink } from "@/lib/insights/offers";
import { recordClick, syncConsent } from "@/lib/insights/offers-server";

/**
 * Resend → CMS (docs/offers-consent-contract.md). Public, but only Resend can sign a request.
 *   email.clicked           a click on a blog article counts as interest, only with offers consent
 *   contact.topics.updated  re-read that contact's consent; without it, its clicks are deleted
 *   contact.updated/deleted the same
 * Answers 2xx once handled; anything else makes Resend retry.
 */
export async function POST(request: Request) {
  const secret = getEnv().RESEND_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "webhook not configured" }, { status: 503 });

  const body = await request.text();
  const h = request.headers;
  if (!verifySvix(secret, { id: h.get("svix-id"), timestamp: h.get("svix-timestamp"), signature: h.get("svix-signature") }, body)) {
    return Response.json({ error: "bad signature" }, { status: 401 });
  }

  let event: { type?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(body);
  } catch {
    return Response.json({ error: "not JSON" }, { status: 400 });
  }
  const data = event.data ?? {};
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

  try {
    if (event.type === "email.clicked") {
      const to = Array.isArray(data.to) ? str(data.to[0]) : str(data.to);
      const link = str((data.click as { link?: unknown } | undefined)?.link);
      // Emails link to the live site; SITE_URL may point at staging.
      const slug = link ? (slugFromLink(link, getEnv().SITE_ORIGIN) ?? slugFromLink(link)) : null;
      if (to && slug) await recordClick(to.toLowerCase(), slug);
    } else if (event.type?.startsWith("contact.")) {
      // The payload's shape for contact events is not documented in detail: take what identifies the contact.
      const email = str(data.email)?.toLowerCase();
      const contactId = str(data.contact_id) ?? str(data.id);
      if (email || contactId) await syncConsent({ email, contactId });
    }
  } catch (e) {
    console.error(`[webhook] ${event.type} failed`, e instanceof Error ? e.message : e);
    return Response.json({ error: "failed, retry" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
