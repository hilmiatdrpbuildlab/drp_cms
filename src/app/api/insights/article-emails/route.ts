import { getStaff } from "@/auth/server";
import { articleEmailSnapshot } from "@/lib/insights/article-emails-server";
import { resendConfigured } from "@/lib/resend";

export const dynamic = "force-dynamic";

/** Live delivered / opened / clicked counts of the recent new-article emails, for the Insights table. */
export async function GET() {
  const staff = await getStaff();
  if (!staff) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!resendConfigured()) return Response.json({ error: "RESEND_API_KEY is not set" }, { status: 503 });

  try {
    return Response.json(await articleEmailSnapshot(), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[insights] article email stats failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Could not read the email results from Resend" }, { status: 502 });
  }
}
