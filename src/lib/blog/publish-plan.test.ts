import assert from "node:assert/strict";
import { test } from "node:test";

import { parseMarkdownFile, slugify, toMarkdownFile } from "./contract.ts";
import { collectMediaKeys, planPublish, rewriteMediaUrls, type PostForPublish } from "./publish-plan.ts";

const ID = "3f1c2b9e-1111-4aaa-8bbb-123456789abc";
const IMG = `posts/${ID}/a1b2c3-diagram.png`;
const COVER = `posts/${ID}/d4e5f6-cover.webp`;

const base: PostForPublish = {
  title: "How we automated quote follow-ups",
  slug: "automated-quote-follow-ups",
  excerpt: "A look at the workflow that turns a website form into a tracked lead in seconds.",
  body: `Intro paragraph that is long enough to count as real content for the article.\n\n![Flow](/api/media/${IMG})\n\nMore text.`,
  category: "technical",
  tags: ["automation", "n8n"],
  langs: ["en", "nl"],
  authorName: "Hilmi",
  date: null,
  coverKey: COVER,
  coverAlt: "Workflow diagram",
  video: null,
  publishedSlug: null,
};

test("slugify", () => {
  assert.equal(slugify("Hello, Wörld! -- Ünïcode  "), "hello-world-unicode");
  assert.equal(slugify("Tinrate × DRP: 2026"), "tinrate-drp-2026");
});

test("collects and rewrites media references", () => {
  assert.deepEqual(collectMediaKeys(base.body + `\n![again](/api/media/${IMG})`), [IMG]);
  assert.equal(
    rewriteMediaUrls(`![x](/api/media/${IMG})`, "my-post"),
    "![x](./media/my-post/a1b2c3-diagram.png)",
  );
  // Absolute URLs elsewhere are left alone.
  assert.equal(rewriteMediaUrls("![x](https://cdn.example.com/a.png)", "s"), "![x](https://cdn.example.com/a.png)");
});

test("first publish: date defaults to today, no `updated`, images copied", () => {
  const r = planPublish(base, "2026-11-04");
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  const { plan } = r;
  assert.equal(plan.markdownPath, "content/blog/automated-quote-follow-ups.md");
  assert.equal(plan.frontmatter.date, "2026-11-04");
  assert.equal(plan.frontmatter.updated, undefined);
  assert.equal(plan.oldSlug, null);
  assert.deepEqual(plan.media.map((m) => m.path).sort(), [
    "content/blog/media/automated-quote-follow-ups/a1b2c3-diagram.png",
    "content/blog/media/automated-quote-follow-ups/d4e5f6-cover.webp",
  ]);
  assert.ok(plan.markdown.includes("![Flow](./media/automated-quote-follow-ups/a1b2c3-diagram.png)"));
  assert.ok(!plan.markdown.includes("/api/media/"));

  // Round-trips through the parser drp_compro-side tooling would use.
  const parsed = parseMarkdownFile(plan.markdown);
  assert.equal(parsed.frontmatter.cover?.src, "./media/automated-quote-follow-ups/d4e5f6-cover.webp");
  assert.equal(parsed.frontmatter.draft, false);
  assert.deepEqual(parsed.frontmatter.langs, ["en", "nl"]);
});

test("republish under a new slug: keeps date, sets updated, removes old file", () => {
  const r = planPublish({ ...base, slug: "quote-follow-ups", date: "2026-10-01", publishedSlug: "automated-quote-follow-ups" }, "2026-11-04");
  assert.ok(r.ok);
  assert.equal(r.plan.frontmatter.date, "2026-10-01");
  assert.equal(r.plan.frontmatter.updated, "2026-11-04");
  assert.equal(r.plan.oldSlug, "automated-quote-follow-ups");
});

test("refuses incomplete articles with readable errors", () => {
  const r = planPublish({ ...base, excerpt: "short", coverAlt: "", body: "tiny", slug: "Bad Slug" }, "2026-11-04");
  assert.equal(r.ok, false);
  const errors = !r.ok ? r.errors.join("\n") : "";
  assert.match(errors, /slug/);
  assert.match(errors, /excerpt/);
  assert.match(errors, /alt text/);
  assert.match(errors, /body/);
});

test("collab video: https only, poster image copied", () => {
  const poster = `posts/${ID}/ff0011-poster.jpg`;
  const r = planPublish(
    {
      ...base,
      category: "collab",
      video: { url: "https://www.youtube.com/watch?v=abc", aspect: "9:16", poster: `/api/media/${poster}`, creator: "@someone" },
    },
    "2026-11-04",
  );
  assert.ok(r.ok);
  assert.equal(r.plan.frontmatter.video?.poster, "./media/automated-quote-follow-ups/ff0011-poster.jpg");
  assert.ok(r.plan.media.some((m) => m.key === poster));

  const bad = planPublish({ ...base, video: { url: "http://insecure.example.com/v.mp4", aspect: "16:9" } }, "2026-11-04");
  assert.equal(bad.ok, false);
});

test("serialised frontmatter has a stable key order", () => {
  const r = planPublish(base, "2026-11-04");
  assert.ok(r.ok);
  const keys = r.plan.markdown
    .split("---")[1]
    .split("\n")
    .filter((l) => /^[a-z]+:/.test(l))
    .map((l) => l.split(":")[0]);
  assert.deepEqual(keys, ["title", "slug", "date", "author", "category", "tags", "langs", "excerpt", "cover", "draft"]);
  assert.equal(toMarkdownFile(r.plan.frontmatter, "x\r\ny").endsWith("x\ny\n"), true);
});
