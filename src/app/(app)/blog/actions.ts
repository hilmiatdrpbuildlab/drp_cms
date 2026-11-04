"use server";

import { randomBytes } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getStaff } from "@/auth/server";
import { articleMediaDir, articlePath, CATEGORIES, LANGS, SLUG_RE, VIDEO_ASPECTS } from "@/lib/blog/contract";
import { planPublish } from "@/lib/blog/publish-plan";
import { getDb } from "@/lib/db";
import { commitFiles, GitHubError, listFiles, type FileChange } from "@/lib/github";
import { media, posts } from "@/lib/schema";
import { deleteObject, getObjectBytes } from "@/lib/storage";

// Typed results instead of throws: in production Next.js hides a thrown error's message.
export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string; errors?: string[] };

const UNAUTHENTICATED = { ok: false as const, error: "Your session ended. Sign in again in another tab, then retry." };

/** Postgres error code; Drizzle wraps the driver error in `cause`. */
const pgCode = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err.cause?.code ?? err.code;
};

/** The site's date: Belgium. */
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(new Date());

export async function createPost() {
  const staff = await getStaff();
  if (!staff) redirect("/sign-in");
  const [row] = await getDb()
    .insert(posts)
    .values({
      title: "Untitled article",
      slug: `untitled-${randomBytes(3).toString("hex")}`,
      authorName: staff.name,
      createdBy: staff.email,
      updatedBy: staff.email,
    })
    .returning({ id: posts.id });
  redirect(`/blog/${row.id}`);
}

const saveInput = z.object({
  id: z.uuid(),
  /** The updatedAt the editor loaded; a mismatch means someone else saved in between. */
  expectedUpdatedAt: z.string(),
  title: z.string().trim().min(1, "Title is required").max(160),
  slug: z.string().trim().regex(SLUG_RE, "Slug: lowercase letters, digits and single hyphens").min(3).max(80),
  excerpt: z.string().max(300),
  body: z.string().max(200_000),
  category: z.enum(CATEGORIES),
  tags: z.array(z.string().trim().min(1).max(40)).max(12),
  langs: z.array(z.enum(LANGS)).min(1, "Pick at least one language"),
  authorName: z.string().trim().max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  coverKey: z.string().nullable(),
  coverAlt: z.string().max(200),
  video: z
    .object({
      url: z.string().trim().max(500),
      poster: z.string().trim().max(500).optional(),
      aspect: z.enum(VIDEO_ASPECTS),
      creator: z.string().trim().max(120).optional(),
      sourceUrl: z.string().trim().max(500).optional(),
    })
    .nullable(),
});
export type SaveInput = z.input<typeof saveInput>;

export async function savePost(raw: SaveInput): Promise<ActionResult<{ updatedAt: string }>> {
  const staff = await getStaff();
  if (!staff) return UNAUTHENTICATED;
  const parsed = saveInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Some fields are invalid.", errors: parsed.error.issues.map((i) => i.message) };
  const { id, expectedUpdatedAt, ...fields } = parsed.data;

  try {
    const [row] = await getDb()
      .update(posts)
      .set({ ...fields, video: fields.video?.url ? fields.video : null, updatedBy: staff.email, updatedAt: new Date() })
      .where(and(eq(posts.id, id), eq(posts.updatedAt, new Date(expectedUpdatedAt))))
      .returning({ updatedAt: posts.updatedAt });
    if (!row) {
      return {
        ok: false,
        error: "Someone else saved this article after you opened it. Copy your changes, reload the page, and apply them again.",
      };
    }
    revalidatePath("/blog");
    return { ok: true, updatedAt: row.updatedAt.toISOString() };
  } catch (e) {
    if (pgCode(e) === "23505") return { ok: false, error: "Another article already uses this slug." };
    throw e;
  }
}

export async function publishPost(
  id: string,
): Promise<ActionResult<{ updatedAt: string; date: string; commitUrl: string }>> {
  const staff = await getStaff();
  if (!staff) return UNAUTHENTICATED;
  const db = getDb();
  const [post] = await db.select().from(posts).where(eq(posts.id, id));
  if (!post) return { ok: false, error: "Article not found." };

  const result = planPublish(post, today());
  if (!result.ok) return { ok: false, error: "The article isn't ready to publish yet.", errors: result.errors };
  const { plan } = result;

  try {
    const changes: FileChange[] = [{ path: plan.markdownPath, content: plan.markdown }];
    for (const m of plan.media) {
      const bytes = await getObjectBytes(m.key);
      if (!bytes) return { ok: false, error: `An image is missing from storage: ${m.key}. Remove it and upload it again.` };
      changes.push({ path: m.path, content: bytes });
    }
    // Images the article no longer uses.
    const keep = new Set(plan.media.map((m) => m.path));
    for (const path of await listFiles(plan.mediaDir)) if (!keep.has(path)) changes.push({ path, delete: true });
    // Renamed since the last publish: take the old URL down too.
    if (plan.oldSlug) {
      changes.push({ path: articlePath(plan.oldSlug), delete: true });
      for (const path of await listFiles(articleMediaDir(plan.oldSlug))) changes.push({ path, delete: true });
    }

    const verb = post.publishedSlug ? "update" : "publish";
    const commit = await commitFiles(changes, `blog: ${verb} "${post.title}" (${plan.frontmatter.slug})\n\nPublished from cms.drpbuildlab.com by ${staff.email}`, {
      name: staff.name,
      email: staff.email,
    });

    const now = new Date();
    const [row] = await db
      .update(posts)
      .set({
        status: "published",
        date: plan.frontmatter.date,
        publishedSlug: plan.frontmatter.slug,
        publishedAt: now,
        publishedBy: staff.email,
        publishedCommit: commit.sha,
        updatedAt: now,
      })
      .where(eq(posts.id, id))
      .returning({ updatedAt: posts.updatedAt });
    revalidatePath("/blog");
    return { ok: true, updatedAt: row.updatedAt.toISOString(), date: plan.frontmatter.date, commitUrl: commit.url };
  } catch (e) {
    if (e instanceof GitHubError) {
      console.error("[publish]", e.message);
      return { ok: false, error: e.status === 401 || e.status === 403 ? "GitHub refused the token. Check GITHUB_TOKEN." : e.message };
    }
    throw e;
  }
}

export async function unpublishPost(id: string): Promise<ActionResult<{ updatedAt: string; commitUrl: string }>> {
  const staff = await getStaff();
  if (!staff) return UNAUTHENTICATED;
  const db = getDb();
  const [post] = await db.select().from(posts).where(eq(posts.id, id));
  if (!post?.publishedSlug) return { ok: false, error: "This article isn't published." };

  try {
    const slug = post.publishedSlug;
    const changes: FileChange[] = [
      { path: articlePath(slug), delete: true },
      ...(await listFiles(articleMediaDir(slug))).map((path) => ({ path, delete: true as const })),
    ];
    const commit = await commitFiles(changes, `blog: unpublish "${post.title}" (${slug})\n\nUnpublished from cms.drpbuildlab.com by ${staff.email}`, {
      name: staff.name,
      email: staff.email,
    });
    const [row] = await db
      .update(posts)
      .set({ status: "draft", publishedSlug: null, publishedCommit: commit.sha, updatedAt: new Date(), updatedBy: staff.email })
      .where(eq(posts.id, id))
      .returning({ updatedAt: posts.updatedAt });
    revalidatePath("/blog");
    return { ok: true, updatedAt: row.updatedAt.toISOString(), commitUrl: commit.url };
  } catch (e) {
    if (e instanceof GitHubError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function deletePost(id: string): Promise<ActionResult> {
  const staff = await getStaff();
  if (!staff) return UNAUTHENTICATED;
  const db = getDb();
  const [post] = await db.select().from(posts).where(eq(posts.id, id));
  if (!post) return { ok: false, error: "Article not found." };
  if (post.publishedSlug) return { ok: false, error: "Unpublish the article before deleting it." };

  const files = await db.select({ key: media.key }).from(media).where(eq(media.postId, id));
  await Promise.all(files.map((f) => deleteObject(f.key).catch(() => undefined)));
  if (files.length) await db.delete(media).where(inArray(media.key, files.map((f) => f.key)));
  await db.delete(posts).where(eq(posts.id, id));
  revalidatePath("/blog");
  redirect("/blog");
}
