"use server";

import { revalidatePath } from "next/cache";

import { getStaff } from "@/auth/server";
import { parseRange } from "@/lib/insights/website";
import { getWebsiteAnalytics, websiteSetupProblems } from "@/lib/insights/website-server";

import type { ActionResult } from "../../blog/actions";

/** The Refresh button: ask GA4 now instead of using the hour-old cache. Admins only. */
export async function refreshWebsiteAnalytics(days: string): Promise<ActionResult> {
  const staff = await getStaff();
  if (!staff) return { ok: false, error: "Your session ended. Sign in again in another tab, then retry." };
  if (!staff.isAdmin) return { ok: false, error: "Only admins can refresh website analytics." };
  if (websiteSetupProblems().length) return { ok: false, error: "Google Analytics is not set up yet." };

  try {
    const result = await getWebsiteAnalytics(parseRange(days), { force: true });
    revalidatePath("/insights/website");
    if (result.source === "stale") return { ok: false, error: "Google Analytics did not answer. Still showing the last saved data." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Google Analytics did not answer. Try again in a minute." };
  }
}
