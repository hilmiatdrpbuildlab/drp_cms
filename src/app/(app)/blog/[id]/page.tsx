import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireStaff } from "@/auth/server";
import type { Lang } from "@/lib/blog/contract";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { posts } from "@/lib/schema";

import { Editor, type EditorPost } from "./editor";

export const metadata: Metadata = { title: "Edit article" };

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const [post] = await getDb().select().from(posts).where(eq(posts.id, id.data));
  if (!post) notFound();

  const env = getEnv();
  const initial: EditorPost = {
    id: post.id,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    body: post.body,
    category: post.category,
    tags: post.tags,
    langs: post.langs as Lang[],
    authorName: post.authorName,
    date: post.date,
    coverKey: post.coverKey,
    coverAlt: post.coverAlt,
    video: post.video ?? null,
    updatedAt: post.updatedAt.toISOString(),
    publishedSlug: post.publishedSlug,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    publishedBy: post.publishedBy,
    publishedCommit: post.publishedCommit,
  };
  return (
    <Editor
      initial={initial}
      repo={env.GITHUB_REPO}
      branch={env.GITHUB_BRANCH}
      canPublish={!!env.GITHUB_TOKEN}
      siteUrl={env.SITE_URL ?? null}
    />
  );
}
