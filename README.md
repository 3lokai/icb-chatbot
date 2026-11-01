# ICB Barista AI

A **headless** Indian specialty-coffee assistant. The chat interface is your existing **WhatsApp Business Cloud API, Instagram Professional account DM inbox, and Facebook Page Messenger inbox**. No customer-facing UI or chat widget.

## Status

**Runnable starter, not yet deployed.** Eleven automated tests pass without any secrets. Actual Meta tokens, OpenRouter key, ICB API key, HTTPS endpoint and a Supabase migration are required before a live message can be processed. Keep `BOT_MODE=draft` for the first integration test.

## What it uses — verified against existing ICB projects (28 October 2026)

| Source | Repository / database | Integration |
| --- | --- | --- |
| Articles | `3lokai/studio-icb` — Sanity project `otnc59kw`, `production` | Read-only GROQ of **published** `article` documents, portable-text conversion, keyword-ranked grounding and article links. 10-minute in-memory cache. |
| Coffee catalogue | `3lokai/icb-v2` — `GET /api/v1/coffees` | Uses your existing **authenticated** ICB coffee API, not direct SQL, to filter by stock, normalized INR/250g budget, roast, process and brewing method. Ranks factual matches and prints API-supplied names/prices/buy links. |
| Brewing diagnosis | `3lokai/icb-v2/src/lib/tools/compass` | Headless **simplified** adaptation of ICB Coffee Compass symptom scoring. Uses explicit method-aware corrective advice; not a complete clone of the site's diagnostic engine. |
| Coffee ratio | `3lokai/icb-v2` coffee calculator | Pure arithmetic. |
| Grind settings | `3lokai/icb-v2/src/lib/tools/grind-guide.ts` | Sends verified grinder-specific enquiries to existing website tool; full conversion table **not yet ported**. |
| Memory + work queue | ICB-v3 Supabase project `fnpsnzqedznsgzxjsowe` | Two isolated, RLS-protected `icb_bot_*` tables, migration included and **not automatically applied**. |
| AI | OpenRouter existing account | Default `openrouter/free`. A credit-loaded account can still use free models. Optional OpenAI provider switch. |

Current ICB-v3 catalog snapshot at inspection: **1,677 active coffees, 119 active roasters**. These figures are not hardcoded in the bot.

## Architecture

```text
WhatsApp Cloud webhook / Instagram DM webhook / Facebook Page Messenger webhook
  -> GET Meta challenge / POST HMAC SHA256 verification
  -> normalize inbound text and validate your account IDs
  -> idempotent Supabase queue (unique platform + account + Meta message ID)
  -> background poller (single VPS instance)
  -> conversation history + optional per-channel taste preferences
  -> OpenRouter planner (intent and user-supplied preferences)
  -> intent: buy        -> existing authenticated ICB coffee API -> deterministic ranking
  -> intent: extraction -> headless Coffee Compass heuristic
  -> intent: ratio      -> pure calculation
  -> intent: grind      -> verified web tool link, no fabricated click numbers
  -> intent: learn      -> Sanity article excerpts / progression
  -> LLM prose reply (catalogue listings remain deterministic)
  -> Supabase outbound row: draft or ready
  -> Meta send API (only if auto / admin-approved)
```

**Important design choice:** The model does **not** invent coffees. For a product recommendation, the final list is composed directly from API rows, including live-in-stock filters and existing shop links. If the ICB API is unavailable, the assistant says so instead of guessing.

## Setup

Requires Node.js 22.12+ or Docker and an externally reachable HTTPS URL.

1. Copy `.env.example` to `.env` and populate the secrets **manually**. No secrets belong in Git.
2. Run `npm test` (zero npm dependencies; uses Node built-ins).
3. Open your **existing** Supabase `ICB-v3` SQL editor, review and run `sql/001_bot_tables.sql`. This adds only two new tables. **It does not change existing coffee tables.**
4. Use your ICB **site-generated API key** for `ICB_API_KEY`. `ICB_API_BASE` points at the existing site `/api/v1/coffees`. The API accepts `X-API-Key` or Bearer authentication.
5. Set your OpenRouter account key and `OPENROUTER_MODEL=openrouter/free`. No paid-model fallback is configured. You can pin a particular `:free` model later once you benchmark it. Keep `LLM_MIN_INTERVAL_MS=3500` as a per-process free-model RPM safeguard.
6. Set `SUPABASE_URL` and a **server-side service-role JWT key**. Do not use the anon or publishable key for these protected bot tables. Do not put the service role in frontend code.
7. Configure Meta app secret, random webhook verification token, account IDs and appropriate messaging tokens (below).
8. Start locally using `npm start`. For VPS, use `docker compose up -d --build` and place a TLS reverse proxy in front of `127.0.0.1:8080` (e.g. Caddy or Nginx). Keep one instance for the included queue/pacing implementation.
9. In your Meta developer dashboard, register `https://YOUR_HOST/webhooks/meta`, set the matching verify token, subscribe the relevant messaging events and verify test messages from your role/test users.
10. Begin in `BOT_MODE=draft`. Inspect generated drafts in Supabase. Switch to `BOT_MODE=auto` only after permission/access checks, tests, disclosure and review.

For a CLI smoke test (no Meta required):

```sh
npm run ask -- "Suggest a fruity natural roast under Rs 600 per 250g"
npm run ask -- "My V60 tastes bitter and dry, how do I fix it?"
```

CLI needs `.env` with an LLM key; recommendation testing also needs the ICB API key. No SQL migration is needed to run the CLI.

## Meta configuration and limitations

**WhatsApp Cloud API:** `META_WHATSAPP_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`; app requires WhatsApp messaging access. Webhook object: `whatsapp_business_account`, messages changes. Sending uses `POST /{phone-number-id}/messages`.

**Facebook Messenger:** This means **a Facebook Page**, not personal Facebook profile Messenger. Configure `META_FACEBOOK_PAGE_TOKEN` and `META_FACEBOOK_PAGE_ID`; app needs applicable Page messaging permissions (`pages_messaging` and other permissions required by your setup). Webhook object: `page`. Sending uses `POST /{page-id}/messages`.

**Instagram:** Requires an **Instagram Professional** account (Business/Creator), not a personal Instagram account. The code supports `META_INSTAGRAM_LOGIN_MODE=instagram` (Instagram Login, `graph.instagram.com/{ig-user-id}/messages`, an Instagram professional token, permission such as `instagram_business_manage_messages`) and `META_INSTAGRAM_LOGIN_MODE=facebook` (Facebook Login flow linked to your Page using a Page token). Set `META_INSTAGRAM_USER_ID` to the Instagram business account ID. Webhook object: `instagram`.

Meta account linking **does not automatically establish API permission for public conversations**. App Review / Advanced Access / business verification may be required depending on the channel, login flow and audience. User-initiated conversations and customer-service window restrictions apply; this bot deliberately does not send unsolicited outreach or WhatsApp template messages. The sender refuses free-form outgoing messages after a conservative 23-hour cutoff. Messenger/Instagram policy restrictions must still be observed.

**Text-only MVP:** Supports inbound WhatsApp text and reply-button/list text, plus Instagram and Page Messenger text. Attachments, stories, comments, voice notes and media understanding are not implemented. Ignores read receipts and own-message echoes. WhatsApp phone number onboarding / coexistence with the WhatsApp Business mobile app must be configured in Meta separately.

## Draft-first controls

- `BOT_MODE=draft`: create an outbound draft in `icb_bot_messages`, do not send it.
- `BOT_MODE=auto`: send only replies to incoming conversations under the service window.
- `BOT_MODE=off`: accept signed webhook deliveries but ignore messages.
- `STOP`, `UNSUBSCRIBE`, `OPT OUT` update channel-local opt-out; `START` removes opt-out. No cross-channel profile matching is performed.

A manually approved draft can be sent through a secret-protected endpoint (still within the reply window):

```sh
curl -X POST 'https://YOUR_HOST/admin/approve' \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"id":"UUID-OF-OUTBOUND-DRAFT-ROW"}'
```

The admin endpoint never accepts arbitrary outbound recipient/message text. It only sends a pre-existing draft. **No frontend dashboard is included**; use your Supabase dashboard for draft inspection.

## Operational / security notes

- HMAC SHA-256 verified over **raw** Meta webhook bytes (not a reserialized JSON payload).
- Inbound event queue de-duplicated by Meta message ID; outbound records unique per incoming message.
- The poller claims queued or stale items and uses statuses `queued → processing → done` plus outbound `draft / ready → sending → sent`.
- For ambiguous failures while calling Meta, outbound status is `failed` and **is not retried automatically**, to avoid duplicate replies. Investigate delivery manually first. For LLM failures, the inbound status is `failed` (also requires manual review/requeue).
- The included worker assumes **one application instance**, not a multi-worker distributed fleet. For scaling, switch to a proper Postgres claim RPC or queue and centralized provider rate limits.
- Meta webhooks must finish before timeout; storing the inbound event happens before HTTP 200. Inference happens in the worker.
- Database bot tables have RLS enabled and no anon/authenticated policies. All operations use a server-only credential.
- Do **not** log API secrets or customer message bodies. Retain only the chat text needed for conversation memory. Add your own retention/erasure schedule and privacy notice before public launch.
- OpenRouter's free routing may select providers with different data-handling policies. Review model/provider retention settings before passing customer chat data into a public bot.
- Avoid registering an AI auto-replier on private personal DMs without confirming the channel and permissions.

## Known MVP limits / recommended next iterations

1. **Integration testing remains outstanding.** No credentials or production calls were supplied, so neither OpenRouter, Meta send, Sanity fetch nor the authenticated coffee API has been live-tested from this environment. Local unit + webhook tests pass.
2. **Sanity retrieval is keyword-ranked, not embeddings.** Once usage validates the idea, add chunked Sanity indexing and `pgvector` with a change webhook. No reason to incur embedding complexity before validation.
3. **Coffee Compass is a simplified, traceable headless adaptation.** Extract the site's full engine as a shared library/package for perfect behavioural parity.
4. **Grind tool** currently links to the site's existing verified converter rather than hosting its entire grinder database. Extract the pure module to a common package later.
5. **User preferences** persist separately per platform/account/contact. Explicit opt-in identity linking, brew history and learned progress stages can be added later.
6. **Meta sends** are currently text-only and one message per reply; Long replies are split into sequential channel-sized text messages. Rich cards and media remain unimplemented. If one part sends and another fails, review delivery manually before retrying.
7. **Free-model quotas** still apply even to credit-loaded OpenRouter accounts. The current `openrouter/free` router is $0 per token but not unlimited.

## GitHub repository

Source code is maintained at `https://github.com/3lokai/icb-chatbot`. Configure `.env` locally and keep all Meta, Supabase, ICB and model provider credentials out of Git. The Supabase migration and Meta integration are intentionally not applied automatically.
