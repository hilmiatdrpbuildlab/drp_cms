/**
 * The contract between this CMS and drp_compro: what a file in content/blog/ looks like.
 * docs/blog-content-contract.md describes the same thing for the site side. Change both together.
 *
 * Pure module (no server/DB imports) so it can be unit-tested with `node --test`.
 */
import { parse, stringify } from "yaml";
import { z } from "zod";

/** Every language drp_compro has a market for (assets/markets.js). */
export const LANGS = ["en", "nl", "fr", "de", "it", "es", "pl", "pt", "id", "ja", "ar", "af"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANGS: Lang[] = ["en", "nl", "fr"];

export const LANG_NAMES: Record<Lang, string> = {
  en: "English",
  nl: "Nederlands",
  fr: "Français",
  de: "Deutsch",
  it: "Italiano",
  es: "Español",
  pl: "Polski",
  pt: "Português",
  id: "Bahasa Indonesia",
  ja: "日本語",
  ar: "العربية",
  af: "Afrikaans",
};

export const CATEGORIES = ["technical", "partner", "collab"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABELS: Record<Category, string> = {
  technical: "Technical article",
  partner: "Client / partner story",
  collab: "Social collaboration",
};

export const VIDEO_ASPECTS = ["16:9", "9:16", "1:1"] as const;

/** Where the article files live in drp_compro. The GitHub client refuses to write anywhere else. */
export const CONTENT_ROOT = "content/blog/";

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const slugSchema = z
  .string()
  .min(3, "Slug: at least 3 characters")
  .max(80, "Slug: at most 80 characters")
  .regex(SLUG_RE, "Slug: lowercase letters, digits and single hyphens only");

const httpsUrl = z
  .string()
  .trim()
  .url("Must be a full URL")
  .refine((u) => u.startsWith("https://"), "Must start with https://");

export const videoSchema = z.object({
  /** YouTube, Vimeo, Bunny/Cloudflare Stream or a direct .mp4 on a CDN. Never a file in the repo. */
  url: httpsUrl,
  /** Poster shown before the click-to-load consent. A media path once published. */
  poster: z.string().trim().optional(),
  aspect: z.enum(VIDEO_ASPECTS).default("16:9"),
  /** Collab articles: who made it and where the original post lives. */
  creator: z.string().trim().max(120).optional(),
  sourceUrl: httpsUrl.optional(),
});
export type ArticleVideo = z.infer<typeof videoSchema>;

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date: YYYY-MM-DD");

export const frontmatterSchema = z.object({
  title: z.string().trim().min(3).max(160),
  slug: slugSchema,
  date: dateString,
  updated: dateString.optional(),
  author: z.string().trim().min(1).max(120),
  category: z.enum(CATEGORIES),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  langs: z.array(z.enum(LANGS)).min(1).default(DEFAULT_LANGS),
  excerpt: z.string().trim().min(20, "Excerpt: at least 20 characters").max(300, "Excerpt: at most 300 characters"),
  cover: z.object({ src: z.string().min(1), alt: z.string().trim().min(1, "Cover image needs alt text") }).optional(),
  video: videoSchema.optional(),
  draft: z.boolean().default(false),
});
export type ArticleFrontmatter = z.infer<typeof frontmatterSchema>;

export const articlePath = (slug: string) => `${CONTENT_ROOT}${slug}.md`;
export const articleMediaDir = (slug: string) => `${CONTENT_ROOT}media/${slug}/`;
/** How the Markdown file refers to its images: relative to content/blog/. */
export const articleMediaRef = (slug: string, file: string) => `./media/${slug}/${file}`;

/** Serialise to the file drp_compro reads. Key order is fixed so diffs stay readable. */
export function toMarkdownFile(fm: ArticleFrontmatter, body: string): string {
  const ordered: Record<string, unknown> = {
    title: fm.title,
    slug: fm.slug,
    date: fm.date,
    ...(fm.updated && fm.updated !== fm.date ? { updated: fm.updated } : {}),
    author: fm.author,
    category: fm.category,
    tags: fm.tags,
    langs: fm.langs,
    excerpt: fm.excerpt,
    ...(fm.cover ? { cover: fm.cover } : {}),
    ...(fm.video ? { video: stripUndefined(fm.video) } : {}),
    draft: fm.draft,
  };
  const yaml = stringify(ordered, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n\n${body.replace(/\r\n/g, "\n").trim()}\n`;
}

/** The inverse, for tests and for importing hand-written articles later. */
export function parseMarkdownFile(file: string): { frontmatter: ArticleFrontmatter; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(file.replace(/\r\n/g, "\n"));
  if (!m) throw new Error("Missing frontmatter block");
  return { frontmatter: frontmatterSchema.parse(parse(m[1])), body: m[2].trim() };
}

/** "Hello, World! Ünïcode" -> "hello-world-unicode" */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as T;
}
