# Blog content contract (CMS → drp_compro)

This is the interface between `cms.drpbuildlab.com` and the static site. The CMS writes these files; drp_compro's `tools/concept/build.js` reads them. The code side is [src/lib/blog/contract.ts](../src/lib/blog/contract.ts). If you change one, change the other.

## Files

```
content/blog/<slug>.md                 one article
content/blog/media/<slug>/<file>       its images (png, jpg, webp, avif, gif — never svg)
```

The CMS only ever writes inside `content/blog/`. It makes one commit per Publish, Update or Unpublish, which contains the Markdown file and all of its images. The commit author is the staff member who clicked the button.

| Action | What the commit does |
|---|---|
| Publish (first time) | adds `<slug>.md` and `media/<slug>/*` |
| Publish changes | rewrites `<slug>.md`, adds new images, deletes images the article no longer uses, sets `updated` |
| Publish after a slug change | the above under the new slug, and deletes the old `.md` and `media/<old-slug>/` |
| Unpublish | deletes `<slug>.md` and `media/<slug>/` (the draft stays in the CMS) |

Drafts never leave the CMS. A file in `content/blog/` is meant to be live. `draft: true` is still honoured, so that people who write a file by hand can park it.

## Frontmatter

```yaml
---
title: How a website form becomes a tracked lead in 5 seconds
slug: website-form-to-tracked-lead      # [a-z0-9-], 3–80 chars; the URL is /blog/<slug>/
date: 2026-11-04                        # first publish date (YYYY-MM-DD, Europe/Brussels)
updated: 2026-11-20                     # only on republish, and only if it differs from date
author: Hilmi                           # display name; match it to a team profile if one exists
category: technical                     # technical | partner | collab
tags: [automation, forms]
langs: [en, nl, fr]                     # which languages localize.js should produce
excerpt: A look at the automation behind every quote request…   # 20–300 chars: index card + meta description
cover:                                  # optional
  src: ./media/website-form-to-tracked-lead/3f2a1b9c-cover.webp
  alt: Diagram of the form-to-lead flow
video:                                  # optional; mainly for category: collab
  url: https://www.youtube.com/shorts/abc123   # https only; YouTube, Vimeo, Bunny/Cloudflare Stream or a CDN .mp4
  aspect: "9:16"                        # 16:9 | 9:16 | 1:1
  poster: ./media/website-form-to-tracked-lead/77aa01ff-poster.jpg
  creator: "@partnerhandle"
  sourceUrl: https://www.instagram.com/p/…
draft: false
---

Markdown body (GitHub-flavoured: tables, fenced code, task lists). Images look like
![alt](./media/website-form-to-tracked-lead/9c1d22e0-diagram.png)
```

The keys always come in this order, so diffs stay readable. Paths under `media/` are relative to `content/blog/`.

## What the site build does

Implemented in drp_compro by `tools/concept/blog.js`, `build.js` and `localize.js`. Its rules are in `content/blog/README.md` there.

1. Skips files with `draft: true`, including their images.
2. Serves images once from `/media/blog/<slug>/`, not copied into each market. A missing or foreign image fails the build.
3. Renders the body as Markdown **without raw HTML**. The CMS preview ignores HTML too, so what writers see is what they get. Code is never translated.
4. Renders `video` as a click-to-load player: the poster is shown, and the iframe loads only after a click. It uses `youtube-nocookie.com` and Vimeo `dnt=1`.
5. **Always publishes English**, the source language, plus the other languages in `langs`, machine-translated by DeepL. Markets in other languages get no page; their language links point to their `/blog/`. hreflang and the sitemap follow `langs`.
6. Outputs BlogPosting JSON-LD, og:image from the cover, an RSS feed at `/feed.xml`, and sitemap entries.
7. Runs on every push to `main` that touches `content/blog/**` (`.github/workflows/blog.yml`: `build.js` + `localize.js`, then commits `concept/`).
