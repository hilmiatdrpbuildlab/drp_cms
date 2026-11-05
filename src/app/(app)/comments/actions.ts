"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getStaff } from "@/auth/server";
import { getDb } from "@/lib/db";
import { blogComments } from "@/lib/schema";

export type CommentActionResult = { ok: true } | { ok: false; error: string };

const id = z.uuid();

/** Approved comments appear under the article on the website within a minute (no rebuild needed). */
export async function approveComment(commentId: string): Promise<CommentActionResult> {
  const staff = await getStaff();
  if (!staff) return { ok: false, error: "Your session ended. Sign in again." };
  if (!id.safeParse(commentId).success) return { ok: false, error: "Unknown comment." };
  await getDb()
    .update(blogComments)
    .set({ status: "approved", moderatedAt: new Date(), moderatedBy: staff.email })
    .where(eq(blogComments.id, commentId));
  revalidatePath("/comments", "layout");
  return { ok: true };
}

/** Takes an approved comment off the website again, back into the queue. */
export async function hideComment(commentId: string): Promise<CommentActionResult> {
  const staff = await getStaff();
  if (!staff) return { ok: false, error: "Your session ended. Sign in again." };
  if (!id.safeParse(commentId).success) return { ok: false, error: "Unknown comment." };
  await getDb()
    .update(blogComments)
    .set({ status: "pending", moderatedAt: new Date(), moderatedBy: staff.email })
    .where(eq(blogComments.id, commentId));
  revalidatePath("/comments", "layout");
  return { ok: true };
}

export async function deleteComment(commentId: string): Promise<CommentActionResult> {
  const staff = await getStaff();
  if (!staff) return { ok: false, error: "Your session ended. Sign in again." };
  if (!id.safeParse(commentId).success) return { ok: false, error: "Unknown comment." };
  await getDb().delete(blogComments).where(eq(blogComments.id, commentId));
  revalidatePath("/comments", "layout");
  return { ok: true };
}
