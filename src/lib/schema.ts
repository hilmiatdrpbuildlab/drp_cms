import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

import type { ArticleVideo } from "./blog/contract.ts";

export const postCategory = pgEnum("post_category", ["technical", "partner", "collab"]);
export const postStatus = pgEnum("post_status", ["draft", "published"]);

/**
 * The working copy of an article. drp_compro only ever sees what Publish commits
 * (content/blog/<slug>.md), so edits here are private until published again.
 */
export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    excerpt: text("excerpt").notNull().default(""),
    body: text("body").notNull().default(""),
    category: postCategory("category").notNull().default("technical"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    langs: text("langs").array().notNull().default(sql`'{en,nl,fr}'::text[]`),
    authorName: text("author_name").notNull().default(""),
    /** The article's date on the site (frontmatter `date`). Set on first publish if empty. */
    date: text("date"),
    coverKey: text("cover_key"),
    coverAlt: text("cover_alt").notNull().default(""),
    video: jsonb("video").$type<ArticleVideo | null>(),
    status: postStatus("status").notNull().default("draft"),

    // Last successful publish, so we can show "unpublished changes", link the commit,
    // and remove the old file when the slug changes.
    publishedSlug: text("published_slug"),
    publishedAt: timestamp("published_at", { withTimezone: true, precision: 3 }),
    publishedBy: text("published_by"),
    publishedCommit: text("published_commit"),
    /** Git blob SHA of the published .md. The site's article page carries it in <meta name="drp-rev">,
     *  which is how the CMS tells that this exact version is live. */
    publishedRev: text("published_rev"),

    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    // precision 3 (all timestamps): JS Dates carry milliseconds, and updatedAt is the editor's
    // optimistic-concurrency token, so it must round-trip exactly.
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [index("posts_updated_at_idx").on(t.updatedAt)],
);

/** Files in the private `media` bucket. Keys look like posts/<postId>/<id>-<name>.<ext>. */
export const media = pgTable(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull().unique(),
    postId: uuid("post_id").references(() => posts.id, { onDelete: "set null" }),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    uploadedBy: text("uploaded_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [index("media_post_id_idx").on(t.postId)],
);

export type Post = typeof posts.$inferSelect;
export type Media = typeof media.$inferSelect;

// ---- Reader reactions on drpbuildlab.com ---------------------------------------------------------
// Written by the site's edge function (netlify/edge-functions/blog.js in drp_compro) as the
// restricted `blog_site` role; see drizzle/0003_blog_site_role.sql for what that role may do.
// Keyed by the article's slug on the site; publishing a renamed article moves them along.

/** One row per visitor per article. `visitor` is a random id the browser keeps; no personal data. */
export const blogLikes = pgTable(
  "blog_likes",
  {
    slug: text("slug").notNull(),
    visitor: uuid("visitor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.slug, t.visitor] })],
);

export const commentStatus = pgEnum("comment_status", ["pending", "approved"]);

/** Visitors' comments. New ones are `pending` and only appear on the site once someone approves them here. */
export const blogComments = pgTable(
  "blog_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    body: text("body").notNull(),
    /** Language of the market the visitor wrote from, e.g. "nl". */
    lang: text("lang").notNull().default("en"),
    status: commentStatus("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    moderatedAt: timestamp("moderated_at", { withTimezone: true, precision: 3 }),
    moderatedBy: text("moderated_by"),
  },
  (t) => [index("blog_comments_slug_idx").on(t.slug, t.status, t.createdAt), index("blog_comments_status_idx").on(t.status, t.createdAt)],
);

export type BlogComment = typeof blogComments.$inferSelect;
