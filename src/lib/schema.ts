import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

import type { ArticleVideo, Lang } from "./blog/contract.ts";
import type { OfferVersion } from "./insights/offers.ts";

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

/* ── Offers (Phase 2 of the blog newsletter): docs/offers-consent-contract.md ── */

/**
 * The CMS's copy of each subscriber's offers consent. Resend is the source of truth (a topic
 * subscription plus offers_consent_* properties); this copy is kept by the Resend webhook and
 * "Re-check consent", so Insights needn't call Resend once per contact. Sending still goes through
 * the Resend topic, so a stale row can never email someone who withdrew.
 */
export const offerConsents = pgTable("offer_consents", {
  email: text("email").primaryKey(),
  contactId: text("contact_id"),
  optedIn: boolean("opted_in").notNull(),
  /** The approved consent text they agreed to. */
  version: text("version"),
  consentedAt: timestamp("consented_at", { withTimezone: true, precision: 3 }),
  /** signup | reconsent */
  source: text("source"),
  syncedAt: timestamp("synced_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
});

/** Blog articles a consenting subscriber clicked in our emails: their interests. Deleted when consent ends. */
export const articleClicks = pgTable(
  "article_clicks",
  {
    email: text("email").notNull(),
    slug: text("slug").notNull(),
    clicks: integer("clicks").notNull().default(1),
    firstAt: timestamp("first_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    lastAt: timestamp("last_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.email, t.slug] })],
);

export const offerStatus = pgEnum("offer_status", ["draft", "sending", "sent"]);

export type OfferResult = { lang: Lang; recipients: number; segmentId: string; broadcastId: string; sentAt: string };

/** An offer email (e.g. a partner promotion), written per language and sent to consenting subscribers. */
export const offers = pgTable("offers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** The company behind the offer, named in the email. Empty for DRP BuildLab's own. */
  partner: text("partner").notNull().default(""),
  /** Interest tags to target; empty = every consenting subscriber. */
  audienceTags: text("audience_tags").array().notNull().default(sql`'{}'::text[]`),
  versions: jsonb("versions").$type<Partial<Record<Lang, OfferVersion>>>().notNull().default({}),
  status: offerStatus("status").notNull().default("draft"),
  /** One entry per language sent; a failed send resumes with the languages missing here. */
  results: jsonb("results").$type<OfferResult[]>().notNull().default([]),
  createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true, precision: 3 }),
  sentBy: text("sent_by"),
});

/** Current subscribers already asked for offers consent, so nobody is asked twice. */
export const consentRequests = pgTable("offer_consent_requests", {
  email: text("email").primaryKey(),
  sentAt: timestamp("sent_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  sentBy: text("sent_by").notNull(),
});

export type Post = typeof posts.$inferSelect;
export type Offer = typeof offers.$inferSelect;
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
