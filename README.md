# DRP CMS

The internal tool for the DRP Build Lab team, at **cms.drpbuildlab.com**. Module 1 is the **blog editor**, with **Insights** on the blog newsletter and website visitors beside it. The client-project planner will be added here later. It is not part of `drpbuildlab.com` (drp_compro) or the client zone.

```
cms.drpbuildlab.com ──(GitHub API: one commit to content/blog/)──▶ drp_compro
drp_compro ──(GitHub Action: build.js + localize.js, commit concept/)──▶ Netlify ──▶ drpbuildlab.com/blog
```

Articles are written and saved here as drafts. **Publish** commits the Markdown and its images to drp_compro, and the site's own pipeline builds, translates and deploys them. The public site stays fully static and never calls the CMS. The file format is specified in [docs/blog-content-contract.md](docs/blog-content-contract.md).

## Stack

- Next.js 16 (App Router, Server Actions), Tailwind 4, TypeScript
- **Neon** project `drp-cms` (`gentle-bird-32275869`, aws-eu-central-1 / Frankfurt):
  - Postgres with Drizzle ORM: tables `posts` and `media` ([src/lib/schema.ts](src/lib/schema.ts)), migrations in `drizzle/`
  - Neon Auth (managed Better Auth): email + password, OTP email verification (to be removed; see Access)
  - Object storage: private bucket `media`, for uploaded images
- Cloudflare Access for SaaS (OIDC, Microsoft Entra ID): the shared Microsoft sign-in of the internal apps
- Netlify for hosting (its own site)

## Access

Only **`@drpbuildlab.com` addresses** get in. The check is in `getStaff()` in [src/auth/server.ts](src/auth/server.ts) and runs on every page, action and API route. Everyone who gets in sees everything, Insights → Website included; the CMS has no admin-only parts.

There are two ways to sign in. Both lead to the same `getStaff()`; a Microsoft sign-in wins when both exist.

### Sign in with Microsoft (shared login of the internal apps)

The company login of all internal apps (DRP Operational, the portal, the CMS, the client zone staff pages): Cloudflare Access with Microsoft Entra ID, the same sign-in session for every app. drp-operational's `docs/INTERNAL_GATEWAY.md` has the overall picture.

The CMS stays on `cms.drpbuildlab.com`, whose DNS is not on Cloudflare, so Access cannot stand in front of it. Instead the CMS uses Access as its **OIDC login provider** ("Access for SaaS", a generic OIDC application in Cloudflare Zero Trust):

1. A signed-out visit to any page goes **straight to** `/sso/login` (Lathif, 21 Nov 2026; the password form stays reachable by opening `/sign-in` directly, until it is removed). `/sso/login` sends the browser to Access, with a `state` and `nonce` kept in a 10-minute signed cookie (`drp_sso_flow`, path `/sso`).
2. Access asks Microsoft only if there is no Cloudflare session yet. Signed in to another internal app already: no prompt, straight back.
3. `/sso/callback` checks the state, exchanges the code (client secret), verifies the id_token (RS256 signature from the app's JWKS, issuer, audience = client id, expiry, nonce) and requires an `@ALLOWED_EMAIL_DOMAIN` address.
4. The CMS then keeps its own session: cookie `drp_staff`, an HS256 JWT signed with `STAFF_SESSION_SECRET` (email, name, Access `sub`), **8 hours**, HttpOnly, Secure, SameSite=Lax. After 8 hours the next page load goes through Access again, with no prompt while the Cloudflare session lives.
5. **Sign out** (`/sso/logout`) clears `drp_staff` and any password session, then opens Cloudflare Access's logout page (`https://<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/logout`), which ends the shared session for every internal app. A CMS tab whose own cookie is still valid can't be reached by a sign-out done in another app; it ends at the latest when its 8 hours are up.

Code: pure logic and its tests in [src/lib/sso.ts](src/lib/sso.ts), [src/lib/sso.test.ts](src/lib/sso.test.ts); discovery, keys and cookies in [src/auth/sso-server.ts](src/auth/sso-server.ts); routes in `src/app/sso/`. Identity is the email (as before: every `created_by`, `updated_by`, `published_by`, `moderated_by` column stores the email, never an account id), so the same person keeps the same history whichever way they signed in.

**Setup.** In Cloudflare Zero Trust → Access → Applications → Add an application → **SaaS** → application type *OIDC* (one app per environment). Redirect URL:

| Environment | Redirect URL to register |
|---|---|
| Production | `https://cms.drpbuildlab.com/sso/callback` |
| Local | `http://localhost:3000/sso/callback` (optional) |

**Not on deploy previews** (Lathif, 21 Nov 2026): set the variables below for the Netlify **Production** deploy context only (at least `CMS_URL`: the sign-in needs all six, so one missing keeps it off). Previews and branch deploys then have no Microsoft sign-in and keep the password login. Set for all contexts, a preview would send every visitor to Access with a redirect URL Access does not know.

Scopes `openid`, `email`, `profile`; policy: Allow, emails ending in `@drpbuildlab.com`, Microsoft Entra ID as login method. Copy the issuer, client id and client secret into the CMS env:

| Variable | Value |
|---|---|
| `ACCESS_OIDC_ISSUER` | The SaaS app's issuer, `https://<team>.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client id>` (the CMS reads `/.well-known/openid-configuration` under it) |
| `ACCESS_OIDC_CLIENT_ID` | Client ID |
| `ACCESS_OIDC_CLIENT_SECRET` | Client secret |
| `ACCESS_TEAM_DOMAIN` | e.g. `drp.cloudflareaccess.com` |
| `STAFF_SESSION_SECRET` | 32+ random characters, its own value (not `NEON_AUTH_COOKIE_SECRET`) |
| `CMS_URL` | `https://cms.drpbuildlab.com`. Every sign-in redirect and the callback use it, never the request's host: on Netlify a function sees its deploy address (`main--drpbuildlab-cms.netlify.app`), which Cloudflare would refuse as redirect URL |

Microsoft sign-in is on only when **all six** are set; with none of them, the CMS behaves as before (a partial set logs which are missing and stays off).

### Email + password (Neon Auth) — to be removed

Login with email + password, verified with a code sent by email (Neon Auth offers no Microsoft sign-in). Sign-up with any other domain is refused before it reaches Neon Auth. Google sign-in is switched off.

**This login stays only until Microsoft sign-in is proven on production; a later change removes it** (and Neon Auth with it). Until then, once everyone on the team has an account, close sign-ups:

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

## Insights (blog newsletter)

The newsletter belongs to the site: drpbuildlab.com's subscribe box, double opt-in and new-article emails are in drp_compro (`netlify/edge-functions/subscribe.js`, `tools/concept/newsletter.js`). Subscribers live in **Resend** as Contacts, one Segment per language (`Blog newsletter (nl)`), and each article email is a Broadcast named `blog:<slug>:<lang>`. The CMS keeps no copy. `/insights` reads Resend directly ([src/lib/resend.ts](src/lib/resend.ts), names parsed in [src/lib/insights/newsletter.ts](src/lib/insights/newsletter.ts)):

- counts, per language and per month, and the subscriber list with search and filters
- **Export CSV** (`/api/insights/subscribers`); every row states the consent scope
- **Unsubscribe** (no more emails, address kept as unsubscribed, as the privacy policy says) and **Delete** (erases the contact, for GDPR erasure requests). Both refuse any contact that is not in a blog segment.
- delivered / opened / clicked people for the 15 most recent article emails, read live from Resend (no cache; the table re-reads every 30 s while visible)

Setup: in the Resend team the site uses, create an API key with **Full access** (a sending-only key can't read contacts) and set it as `RESEND_API_KEY`. Open and click counts need open and click tracking switched on for the sending domain in Resend.

### Offers (Phase 2)

Subscribers can **also** agree, separately and optionally, to offers from DRP BuildLab and partners (e.g. Tinrate). Everyone keeps getting every new article; nobody picks topics. The blog articles a *consenting* subscriber clicks in our emails become their interests (the article's tags). The contract with the site is [docs/offers-consent-contract.md](docs/offers-consent-contract.md); the site side (checkbox, `/blog/offers/` consent page, `/api/subscribe/offers`, privacy text) is in drp_compro.

- **Subscribers tab**: who has offers consent (version and date on hover) and their interests; the setup checklist; *Re-check consent in Resend*; *Ask N subscribers for consent* (one email each, once, linking to the site's consent page).
- **Offers tab** (`/insights/offers`): write an offer per language, pick interest tags (none = everyone with consent), preview, *Send test to me*, then send. Per language it creates a Resend segment `Offer <id> (<lang>)` and a broadcast limited to the offers topic, so Resend itself re-checks consent. Languages without a version are skipped. A send that stops halfway resumes with the missing languages.
- **Webhook** `/api/webhooks/resend` (Svix-signed): `email.clicked` records clicks on blog articles for consenting subscribers; `contact.*` events refresh the CMS's copy of consent (`offer_consents`) and delete clicks when consent ends. Deleting a subscriber in Insights deletes both too.

**Locked until the lawyer approves.** Sending offers and consent requests needs `MARKETING_CONSENT_VERSION`; the site ignores the checkbox without it as well. To go live:

1. Lawyer approves the texts (checkbox, consent page, emails, privacy policy). Deploy the site branch with the approved wording.
2. Set the same `MARKETING_CONSENT_VERSION` (e.g. `2026-11-v1`) and `NEWSLETTER_SECRET` on the site and here, and `MAIL_FROM` here (the site's value).
3. Resend → Webhooks → add `https://cms.drpbuildlab.com/api/webhooks/resend` with events `email.clicked`, `contact.updated`, `contact.deleted`, `contact.topics.updated`; set its signing secret as `RESEND_WEBHOOK_SECRET`.
4. Resend → Domains → drpbuildlab.com → turn on click tracking.
5. `npm run db:migrate` (migration `0004_offers`).

Until then subscribers agreed to **new-article emails only**: don't send them offers or import the list into a CRM for marketing.

## Website analytics (Google Analytics 4)

**Insights → Website** (`/insights/website`, all staff) shows Google Analytics 4 numbers for drpbuildlab.com: GA4 property **"DRP Build Lab"**, id `552973295` (account `407007061`). The site collects through Google Tag Manager container `GTM-T5V7GG6G`; the CMS only reads reports and changes nothing in GTM or on the site.

- **Visitors**: active users, new users and page views, with the change versus the previous period of the same length.
- **Average time on site**: total `userEngagementDuration` ÷ total `activeUsers`, shown as "Xm Ys".
- **Active users per day**: a line chart, with a table view.
- **By market**: views, active users and average time per active user for each market (URL prefix: `/be/`, `/be/fr/`, `/nl/`, …), counted by GA4, so someone who read several pages of a market counts once.
- **Pages by time spent**: one row per page across all markets (`/be/prijzen/` and `/nl/prijzen/` are `/prijzen/`), with views, active users and average engagement time per active user (`userEngagementDuration` ÷ `activeUsers`); open a row for each market's numbers. A page's active users are added up per market, so someone who read the same page in two markets counts twice. Sorted by the average; click a column to sort by another. Pages with fewer than 5 active users in total are hidden until you tick the box.

The market list is a copy of the site's `assets/markets.js` (`MARKETS` in [src/lib/insights/website.ts](src/lib/insights/website.ts)). When the site adds a market, add it there too; until then its pages show as "No market".
- Range: last 7, 28 (default) or 90 days, **ending yesterday** in the property's time zone, like GA4's own "Last 28 days".

For "Last 28 days" the totals should match GA4 → Reports → Engagement → Pages and screens, **Total** row (active users, views, average engagement time per active user), within rounding. Numbers exclude or only estimate visitors who declined analytics cookies.

How it works ([src/lib/insights/website-server.ts](src/lib/insights/website-server.ts), rules in [src/lib/insights/website.ts](src/lib/insights/website.ts)): `runReport` calls to the Google Analytics Data API v1beta from the server, with Google's `@google-analytics/data` client: site totals (this period and the one before), every page path, active users per day, and one small report per market that had visits (at most 4 at a time). The answer is kept in the `analytics_cache` table for **1 hour** per range, well inside the API quota. **Refresh** asks Google straight away. If Google can't be reached, the panel shows the last saved data with "Data from <time>" instead of going blank.

### Setup

1. In a Google Cloud project, enable the **Google Analytics Data API** (APIs & Services → Library). No billing is needed for it.
2. IAM & Admin → Service accounts → create one (e.g. `cms-ga4`), no project roles. Keys → Add key → **JSON**. Keep the downloaded file out of the repo and delete it once it is stored in Netlify.
3. GA4 → Admin → Property **"DRP Build Lab"** → Property access management → add the service account's email (`…@….iam.gserviceaccount.com`) with the **Viewer** role.
4. Set the environment variables (Netlify, and `.env.local` to run it locally):
   - `GA4_SERVICE_ACCOUNT_JSON`: the whole key file's contents (base64 of it also works).
   - `GA4_PROPERTY_ID=552973295`
5. `npm run db:migrate` (migration `0005_analytics_cache`). Without it the panel still works, just without the cache and the fallback.

The key is read on the server only. It is never logged, never sent to the browser, and error messages about it never quote it. Netlify no longer limits function environment variables to 4 KB on its current runtime, so the ~2.3 KB key fits.

## Deploying to Netlify

1. Create a new Netlify site from this repo. `netlify.toml` already holds the build settings and the `noindex` headers.
2. Environment variables: `DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `ALLOWED_EMAIL_DOMAIN`, `GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_BRANCH`, `SITE_URL`, `RESEND_API_KEY` (and for offers `MAIL_FROM`, `MARKETING_CONSENT_VERSION`, `NEWSLETTER_SECRET`, `RESEND_WEBHOOK_SECRET`), `GA4_SERVICE_ACCOUNT_JSON` and `GA4_PROPERTY_ID` for website analytics, and for storage **`NEON_STORAGE_ENDPOINT`, `NEON_STORAGE_ACCESS_KEY_ID`, `NEON_STORAGE_SECRET_ACCESS_KEY`, `NEON_STORAGE_REGION`**, with the values of the `AWS_*` lines in `.env.local`. Netlify reserves the `AWS_*` names for its functions.
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
| `src/lib/resend.ts`, `src/lib/insights/` | Resend access for Insights; segment/broadcast names, summaries, CSV |
| `src/app/(app)/insights/` | the Insights page, unsubscribe and delete actions |
| `src/lib/insights/website*.ts`, `src/app/(app)/insights/website/` | website analytics from GA4: reports, 1-hour cache with fallback, the tab |
| `src/auth/`, `src/proxy.ts` | Neon Auth wiring |
