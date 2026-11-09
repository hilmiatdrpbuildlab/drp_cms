# Offers consent contract (drpbuildlab.com ↔ CMS ↔ Resend)

Phase 2 of the blog newsletter: subscribers may **also** agree to receive offers from DRP BuildLab and its partners (e.g. Tinrate). Everyone keeps receiving every new article as before; nobody picks topics. Interests come only from the blog articles a *consenting* subscriber clicks in our emails.

**Nothing here may go live before a lawyer approves the consent text.** Until `MARKETING_CONSENT_VERSION` is set (site and CMS), the site ignores the checkbox and refuses opt-ins, and the CMS refuses to send offers or consent requests.

## Resend objects

| Object | Value |
|---|---|
| Topic | name `Offers from DRP BuildLab and partners`, `default_subscription: "opt_out"` (only explicit opt-ins receive it), `visibility: "private"` (only opted-in contacts see it on the preference page, so they can opt out). Found by exact name, oldest wins; created by whichever side needs it first. |
| Contact properties (type `string`) | `offers_consent_version` (the approved text version, e.g. `2026-11-v1`), `offers_consent_at` (ISO 8601 UTC), `offers_consent_source` (`signup` or `reconsent`). Created if missing. |
| Opt-in | `PATCH /contacts/{email}/topics` with `[{ "id": <topic id>, "subscription": "opt_in" }]` (if Resend answers 4xx to the bare array, retry with `{ "topics": [...] }`), then `PATCH /contacts/{email}` with `{ "properties": { … } }`. Only for an existing contact with `unsubscribed: false`. |
| Withdrawal | Resend's own preference page (`{{{RESEND_UNSUBSCRIBE_URL}}}` in offer emails), or a global unsubscribe. The CMS learns of it by webhook. |
| Offer emails | One Broadcast per language with `segment_id` = a per-offer segment `Offer <offer id first 8> (<lang>)` and the topic id, so Resend itself re-checks consent. Name `offer:<offer id>:<lang>`. |

## Environment

| Variable | Site (Netlify) | CMS |
|---|---|---|
| `MARKETING_CONSENT_VERSION` | version recorded on opt-in; unset = feature off | same value; unset = sending off |
| `NEWSLETTER_SECRET` | **must be set explicitly** (no RESEND_API_KEY fallback for offers tokens) | same value, to seal consent-request tokens |
| `RESEND_WEBHOOK_SECRET` | – | `whsec_…` of the webhook below |

## Tokens

Same sealing as `netlify/edge-functions/subscribe.js`: key = SHA-256(`"drp-newsletter-token-v1:" + NEWSLETTER_SECRET`), AES-GCM, 12-byte IV prepended, base64url.

- Sign-up token (site): `{ e, l, m, t }` plus `o: "<version>"` when the offers box was ticked and `MARKETING_CONSENT_VERSION` is set. On confirm, `o` → opt-in with source `signup` and that version.
- A returning contact who confirms a sign-up **without** `o` is set to `opt_out` on the offers topic (if the topic exists), so an old opt-in never survives a global unsubscribe and re-subscribe.
- Consent-request token (CMS): `{ e, l, m, t, p: "offers" }`, valid 30 days. `/api/subscribe/confirm` must **reject** any token with `p`. `/api/subscribe/offers` accepts only `p === "offers"`, requires the form field `agree=yes`, and records the *current* `MARKETING_CONSENT_VERSION` with source `reconsent`.

## Site pages

- Subscribe box (`/blog/` and under articles): one extra checkbox, **unticked**, optional, `name="offers" value="yes"`, with the consent text and a privacy link.
- `/<market>/blog/offers/` (noindex): token in the URL fragment `#t=…`; shows the consent text, an unticked checkbox and a confirm button (nothing happens without the tick). States: ask, busy, done, expired, invalid, failed, not-subscribed.
- Its hidden `#mail` block holds, translated like every other string, `<span data-k="…">`:
  - consent-request email: `osubj`, `ohead`, `obody`, `obtn`, `ovalid`, `oignore`
  - offer email footer: `ppartner` ("An offer from our partner"), `pfoot` (why they get it), `punsub` (unsubscribe/manage link label)

The CMS reads that block from `https://drpbuildlab.com/<market>/blog/offers/` (market = `LANG_HOME[lang]`, prefix = market with `-` → `/`), with the same parser as `mailStrings()`.

## CMS webhook

`POST https://cms.drpbuildlab.com/api/webhooks/resend`, Svix-signed. Events: `email.clicked`, `contact.topics.updated`, `contact.updated`, `contact.deleted`.

- `email.clicked`: if the recipient has offers consent, a link to `/…/blog/<slug>/` counts one click on that article.
- contact events: re-read that contact's offers consent; without consent, its clicks are deleted.
