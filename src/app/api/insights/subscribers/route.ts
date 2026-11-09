import { getStaff } from "@/auth/server";
import { toCsv, type OfferConsentInfo } from "@/lib/insights/newsletter";
import { consentsAndInterests } from "@/lib/insights/offers-server";
import { getSubscribers, resendConfigured } from "@/lib/resend";

/** Every blog newsletter subscriber as CSV, for staff only. */
export async function GET() {
  const staff = await getStaff();
  if (!staff) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!resendConfigured()) return Response.json({ error: "RESEND_API_KEY is not set" }, { status: 503 });

  try {
    const [subs, offers] = await Promise.all([
      getSubscribers(),
      // Before the offers migration runs there is no consent copy: export without it.
      consentsAndInterests().catch(() => null),
    ]);
    const info = new Map<string, OfferConsentInfo>();
    for (const [email, c] of offers?.consents ?? []) info.set(email, { ...c, interests: offers?.interests.get(email) ?? [] });
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(new Date());
    console.info(`[insights] ${staff.email} exported ${subs.length} subscribers`);
    return new Response(toCsv(subs, info), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="blog-subscribers-${day}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    console.error("[insights] export failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Could not read the subscribers from Resend" }, { status: 502 });
  }
}
