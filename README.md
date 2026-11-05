# DRP CMS

The internal tool for the DRP Build Lab team, at **cms.drpbuildlab.com**. Module 1 is the **blog editor**. The client-project planner will be added here later. It is not part of `drpbuildlab.com` (drp_compro) or the client zone.

```
cms.drpbuildlab.com ──(GitHub API: one commit to content/blog/)──▶ drp_compro
drp_compro ──(GitHub Action: build.js + localize.js, commit concept/)──▶ Netlify ──▶ drpbuildlab.com/blog
```

Articles are written and saved here as drafts. **Publish** commits the Markdown and its images to drp_compro, and the site's own pipeline builds, translates and deploys them. The public site stays fully static and never calls the CMS. The file format is specified in [docs/blog-content-contract.md](docs/blog-content-contract.md).

## Stack

- Next.js 16 (App Router, Server Actions), Tailwind 4, TypeScript
- **Neon** project `drp-cms` (`gentle-bird-32275869`, aws-eu-central-1 / Frankfurt):
  - Postgres with Drizzle ORM: tables `posts` and `media` ([src/lib/schema.ts](src/lib/schema.ts)), migrations in `drizzle/`
  - Neon Auth (managed Better Auth): email + password, OTP email verification
  - Object storage: private bucket `media`, for uploaded images
- Netlify for hosting (its own site)

## Access

Only **verified `@drpbuildlab.com` addresses** get in. The check is in `getStaff()` in [src/auth/server.ts](src/auth/server.ts) and runs on every page, action and API route. Sign-up with any other domain is refused before it reaches Neon Auth.

The company mail is Microsoft 365, and Neon Auth offers no Microsoft sign-in, so login is email + password, verified with a code sent by email. Google sign-in is switched off.

Once everyone on the team has an account, close sign-ups:

```bash
neon neon-auth config email-password update --project-id gentle-bird-32275869 --branch main --disable-sign-up
```

The verification emails currently come from Neon's shared sender (`auth@mail.myneon.app`, "Neon Auth"). To send them from your own domain, configure SMTP with `neon neon-auth config email-provider update --type standard …` (Resend SMTP works).

## Local development

```bash
npm install
neon link --project-id gentle-bird-32275869 --branch main
neon env pull                      # writes DATABASE_URL, NEON_AUTH_*, AWS_* into .env.local
# then add the app-owned variables from .env.example (NEON_AUTH_COOKIE_SECRET, GITHUB_*)
npm run db:migrate
npm run dev                        # http://localhost:3000
```

For a schema change: edit `src/lib/schema.ts`, run `npm run db:generate`, review the SQL in `drizzle/`, then `npm run db:migrate`. Try risky migrations on a Neon branch first (`neon branches create`).

Checks: `npm test` (the content contract and publish planning), `npm run typecheck`, `npm run build`.

## Publishing setup (GitHub)

1. Create a **fine-grained personal access token**, or better a GitHub App installation token, with **Contents: Read and write** and **Actions: Read** on `Lathif21/drp_compro` only. Actions: Read lets the editor show the site rebuild's progress after Publish.
2. Set it as `GITHUB_TOKEN`. `GITHUB_BRANCH` chooses where articles land. Use a staging branch until the site's blog build exists.
3. A token can't be limited to a folder, so the CMS refuses any path outside `content/blog/` ([src/lib/github.ts](src/lib/github.ts)). To be safe on the GitHub side as well, add a ruleset or CODEOWNERS so that nothing else can change through that token.

Without a token the CMS still works for writing. The Publish button is disabled and explains why.

### Publish progress

After Publish, the editor follows three steps until the website shows the article:

1. The commit, which is instant.
2. The site's "Blog" GitHub Action for that commit. The CMS reads it with the token, which needs Actions: Read.
3. The article page under `SITE_URL`. The CMS stores the git blob SHA of the `.md` it committed (`posts.published_rev`), and the site's build writes the same hash into `<meta name="drp-rev">`. When the page carries that hash, this exact version is live. After Unpublish, the page returning 404 is the signal.

Without `SITE_URL` the steps stop at "built".

## Reader likes and comments

Visitors can like and comment on articles without an account.

- **Where they're stored.** `blog_likes` and `blog_comments` in this database.
- **How the site writes them.** drp_compro's edge function `netlify/edge-functions/blog.js` connects as the restricted role **`blog_site`** through `BLOG_DATABASE_URL`, an environment variable of the *website's* Netlify site. [drizzle/0003_blog_public_role.sql](drizzle/0003_blog_public_role.sql) grants that role exactly this:
  - read, add and remove likes;
  - add comments, which always start as pending;
  - read approved comments.

  Row-level security enforces the comment rules.
- **Moderation.** New comments wait at **Comments** in the CMS, and the nav shows how many are waiting. Approving one shows it on the site within seconds, with no rebuild.
- **Renamed articles.** Publishing a renamed article moves its likes and comments to the new slug.
- **Creating `blog_site`.** Create the role with SQL as the owner (`CREATE ROLE blog_site LOGIN PASSWORD '…' NOBYPASSRLS`). Do **not** use `neon roles create` or the Console: roles made there join `neon_superuser`, which bypasses row-level security and can read every table. Then run the GRANT block of `0003`. The connection string is the owner's, with `blog_site` and its password.

## Deploying to Netlify

1. Create a new Netlify site from this repo. `netlify.toml` already holds the build settings and the `noindex` headers.
2. Environment variables: `DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `ALLOWED_EMAIL_DOMAIN`, `GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_BRANCH`, `SITE_URL`, and for storage **`NEON_STORAGE_ENDPOINT`, `NEON_STORAGE_ACCESS_KEY_ID`, `NEON_STORAGE_SECRET_ACCESS_KEY`, `NEON_STORAGE_REGION`**, with the values of the `AWS_*` lines in `.env.local`. Netlify reserves the `AWS_*` names for its functions.
3. Add the domain `cms.drpbuildlab.com`: a CNAME `cms` pointing to the Netlify site.
4. Add the production origin to Neon Auth's trusted domains: `neon neon-auth domain --help`.

## Where things are

| Path | What |
|---|---|
| `src/lib/blog/contract.ts` | frontmatter schema, languages, categories, Markdown serialiser |
| `src/lib/blog/publish-plan.ts` | turns a post into the files to commit (image copying and URL rewriting) |
| `src/lib/github.ts` | one-commit-per-publish via the Git Data API, with the `content/blog/` guard |
| `src/lib/storage.ts` | Neon bucket access |
| `src/app/(app)/blog/actions.ts` | save (with conflict detection), publish, unpublish, delete |
| `src/app/(app)/blog/[id]/editor.tsx` | the editor: autosave, checklist, languages, settings |
| `src/app/(app)/blog/[id]/rich-editor.tsx` | the visual (Word-like) editor; TipTap reading and writing Markdown |
| `src/app/(app)/blog/[id]/publish-progress.tsx` | the steps shown after Publish |
| `src/app/(app)/comments/` | comment moderation |
| `src/app/api/media/` | image upload (type checked from file bytes, 5 MB max) and serving to staff |
| `src/auth/`, `src/proxy.ts` | Neon Auth wiring |
