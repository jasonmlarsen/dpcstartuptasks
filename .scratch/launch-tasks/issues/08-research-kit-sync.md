# Research: syncing consented email addresses to Kit

Type: research
Status: resolved
Blocked by: —
Map: ../map.md

## Question

Collecting email addresses to communicate with physicians later is a stated reason the product exists. Kit (formerly ConvertKit) owns newsletters; the app must hand it verified, consented addresses. Establish the facts:

1. **Kit's current API.** Authentication (v3 API key vs. v4 OAuth — which is current and which is recommended for a first-party integration), the endpoints for adding a subscriber, tagging, and checking subscription state. Rate limits.
2. **Subscriber vs. tag vs. sequence vs. form** — Kit's model, and which concept correctly represents "signed up for Launch Tasks". This determines whether the owner can email *just* these physicians later.
3. **Double opt-in.** Whether Kit forces a confirmation email for API-added subscribers, and whether that can be skipped given the app has already verified the address via magic link. A second confirmation email the physician did not expect is a real problem.
4. **Unsubscribe and sync direction.** If someone unsubscribes in Kit, how (and whether) the app learns about it. Webhooks available?
5. **Failure handling.** What happens if the Kit API is down at signup — this must never block a physician from registering.
6. **Node SDK or plain fetch?** Whether an official client exists and is maintained.

## Notes for the session

Call the `research` skill. Kit's official developer docs are the primary source. Write findings to `.scratch/launch-tasks/research/kit-sync.md`.

## Answer

Full findings: [`../research/kit-sync.md`](../research/kit-sync.md).

1. **API version / auth.** **V4 is current**; V3 is documented as deprecated and "will be sunset in the future" (no date published). Base URL `https://api.kit.com/v4`. Use an **API key** (`X-Kit-Api-Key` header), not OAuth — Kit's docs scope API keys to "personal account automation / internal tools" and OAuth to Kit App Store apps needing other people's accounts. Rate limits: **120 req / rolling 60s** per API key (600 for OAuth); `429` on breach, exponential backoff recommended.

2. **Model.** Use **one tag** (`launch-tasks-signup`). Tags (and segments) are the only things `POST /v4/broadcasts`'s `subscriber_filter` can target, so a tag is exactly what lets the owner email just these physicians later. A *form* is optional attribution only — and risky, since forms are where double opt-in lives. A *sequence* is wrong for v1: adding someone starts a drip, and no welcome drip has been decided.

3. **Double opt-in — the key finding.** `POST /v4/subscribers` **sends no confirmation email** and creates the subscriber in state `active` (= confirmed, emailable) by default. The confirmation/"Incentive Email" is attached to **double opt-in forms**, and is the only opt-in email mentioned anywhere in Kit's v4 OpenAPI spec. So: create + tag directly, never route registration through a double opt-in form. The physician gets nothing unexpected from Kit. (Kit also warns that an unconfirmed subscriber cannot be confirmed on their behalf — a one-way trap worth avoiding.) Keep our own consent record (checkbox, timestamp) in SQLite regardless.

4. **Unsubscribe / sync direction.** Kit owns subscription state. `POST /v4/subscribers/{id}/unsubscribe` is the API equivalent of the user clicking unsubscribe — consent-revoking and effectively permanent; **tags are retained**, so never infer consent from the tag alone, read `state`. Webhooks exist and were rebuilt 2026-08-27 ("Webhooks 2.0": `POST /v4/webhook_endpoints`, signed with HMAC-SHA256 over `"{t}.{raw_body}"` in `X-Kit-Signature`, 5-minute tolerance, batched, auto-retried ~41h). **Recommend skipping webhooks in v1** — the app sends no newsletters, so nothing breaks if it never learns; add `subscriber.unsubscribed`/`subscriber.complained` only if the UI ever displays subscription state. `GET /v4/subscribers?email_address=…&status=all` answers the question on demand (note: `status` defaults to `active`).

5. **Failure handling.** Registration commits to SQLite first; the Kit call is **never** in the request path. Enqueue a row in a `kit_sync_queue` table and drain it with a background worker using exponential backoff (retry `429`/`5xx`, give up on `422`), 5s client timeout. A durable queue rather than fire-and-forget because both calls are **idempotent upserts** (`201` created / `200` already existed) and losing an hour of addresses to a Kit outage defeats a stated reason the product exists. Resolve the tag ID once at boot, not per registration.

6. **SDK.** **Plain `fetch`.** There is no official Node/TypeScript SDK — Kit's only maintained official SDK is PHP; `Kit/convertkit-react` is a form-embed library last touched in 2023. Three POSTs and a GET; a ~60-line typed module beats a dependency, and Kit publishes an OpenAPI spec if types are wanted.

**Recommended integration:** one V4 API key + one tag. On registration (post-magic-link, post-consent-checkbox), a background worker calls `POST /v4/subscribers` with `{email_address, first_name}` (state omitted → defaults to `active`), then `POST /v4/tags/{tagId}/subscribers` with `{email_address}`. No confirmation email, no form, no sequence, no webhooks in v1.

Unverified and flagged in the research doc: V3 sunset date, the `inactive`→"Unconfirmed" state mapping, presence of rate-limit response headers, whether a form's opt-in setting is API-readable, whether a previously-cancelled subscriber can be reactivated by re-registering, and the owner's plan eligibility for API access.
