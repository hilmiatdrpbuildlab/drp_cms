"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getStaff } from "@/auth/server";
import { forget, syncConsent } from "@/lib/insights/offers-server";
import { blogContactId, deleteContact, ResendError, unsubscribeContact } from "@/lib/resend";

import type { ActionResult } from "../blog/actions";

const UNAUTHENTICATED = { ok: false as const, error: "Your session ended. Sign in again in another tab, then retry." };
const email = z.email().max(254);

async function onBlogList(raw: string, act: (email: string) => Promise<void>, verb: string): Promise<ActionResult> {
  const staff = await getStaff();
  if (!staff) return UNAUTHENTICATED;
  const parsed = email.safeParse(raw.trim().toLowerCase());
  if (!parsed.success) return { ok: false, error: "That is not a valid email address." };
  try {
    const id = await blogContactId(parsed.data);
    if (!id) return { ok: false, error: "This address is not on the blog newsletter (any more)." };
    await act(parsed.data);
    // The contact id, not the address: an erased address should not live on in the logs.
    console.info(`[insights] ${staff.email} ${verb} contact ${id}`);
  } catch (e) {
    console.error(`[insights] ${verb} failed`, e instanceof Error ? e.message : e);
    return { ok: false, error: e instanceof ResendError ? e.message : "Could not reach Resend. Try again in a moment." };
  }
  revalidatePath("/insights");
  return { ok: true };
}

/** No more newsletter emails; the address stays in Resend, marked unsubscribed. */
export async function unsubscribeSubscriber(address: string) {
  // A global unsubscribe also ends offers consent: refresh the CMS's copy (and drop their clicks).
  return onBlogList(address, async (e) => { await unsubscribeContact(e); await syncConsent({ email: e }); }, "unsubscribed");
}

/** Erases the address from Resend, for a GDPR erasure request. */
export async function deleteSubscriber(address: string) {
  return onBlogList(address, async (e) => { await deleteContact(e); await forget(e); }, "deleted");
}
