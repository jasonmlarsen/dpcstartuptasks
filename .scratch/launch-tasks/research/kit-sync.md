# Research: syncing consented email addresses to Kit

Ticket: `../issues/08-research-kit-sync.md`
Researched: 2026-09-16
Primary sources: `developers.kit.com` (official developer docs + the published OpenAPI spec at
`https://developers.kit.com/api-reference/v4.json`), `help.kit.com` (Kit's own help centre),
and the `Kit` GitHub organisation. No third-party blogs or tutorials were used for factual claims.

---

## 1. Which API version, and how to authenticate

### V4 is current. V3 is deprecated.

> "Kit API V4 is the latest version of our API. API V3 is still available for use but is deprecated
> and will be sunset in the future." … "We recommend using API V4 for all new projects."
>
> — https://developers.kit.com/api-reference/overview.md

Base URL is `https://api.kit.com` (the OpenAPI `servers` entry in
https://developers.kit.com/api-reference/v4.json), so endpoints are `https://api.kit.com/v4/...`.
V3's old host `api.convertkit.com/v3/...` is superseded
(https://developers.kit.com/api-reference/upgrading-to-v4.md).

**No sunset date has been published.** The changelog (https://developers.kit.com/changelog.md)
contains no V3 removal date as of 2026-09-16. Treat "deprecated, date unknown" as the risk.

### Two auth methods, and the right one here is the API key

From https://developers.kit.com/api-reference/authentication.md:

| | API Key | OAuth 2.0 |
|---|---|---|
| Header / credential | `X-Kit-Api-Key: <YOUR_V4_API_KEY>` | `Authorization: Bearer <token>` (OAuth2 authorization-code flow) |
| Intended for | "Personal account automation", internal tools, simple programmatic access to your own account | Apps distributed through the **Kit App Store**, multi-user apps |
| Rate limit | **120 requests / rolling 60s per key** | **600 requests / rolling 60s per access token** |
| Caveat | "We do not offer any official support for apps or public integrations that rely upon API keys." | Some endpoints (bulk, purchase creation) require OAuth |

OAuth endpoints, per the OpenAPI `securitySchemes` block in `v4.json`:
`https://api.kit.com/v4/oauth/authorize` and `https://api.kit.com/v4/oauth/token`, scopes `read` and `write`.

**Recommendation: API key.** This is a single-tenant, first-party integration against *the owner's own
Kit account*. That is exactly the "personal account automation / internal tool" case the docs name for
API keys. OAuth exists to let *other people's* Kit accounts authorise *your* app — irrelevant here, and it
buys a token-refresh mechanism (refresh tokens became single-use on 2026-05-26,
https://developers.kit.com/changelog.md) that is pure operational cost for us.

The key is created in Kit's **Developer settings** tab and "you'll not be able to access it again after
leaving the screen" (https://developers.kit.com/api-reference/authentication.md). Store it as
`KIT_API_KEY` in the server environment; it must never reach the browser.

### Rate limits and error codes

From https://developers.kit.com/api-reference/response-codes.md:

- `401` — auth misconfigured, missing, or account access lapsed
- `413` — too many bulk requests enqueued
- `422` — bad/missing data
- `429` — rate limited (600/60s OAuth, 120/60s API key). Kit's advice: "performing an exponential backoff to keep within the limit."
- `500` — retry after a brief delay

The docs do **not** document a `Retry-After` header or any `X-RateLimit-*` headers — *unverified*; assume
they are absent and use your own backoff schedule.

At ~50 practices in six months (per `../map.md`), 120 req/min is roughly four orders of magnitude of
headroom. Rate limiting is not a design constraint for registration traffic; it only matters if a
backfill/replay job is ever written, which should be throttled deliberately.

---

## 2. Kit's data model: subscriber vs. tag vs. form vs. sequence

Grounded in the endpoint set in https://developers.kit.com/api-reference/v4.json and
https://help.kit.com/en/articles/2502651-the-subscriber-profile-page-and-status:

- **Subscriber** — the person. One record per email address on the account. Has a `state`
  (`active`, `inactive`, `bounced`, `cancelled`, `complained`).
- **Tag** — an arbitrary label attached to a subscriber. Created once, applied many times. This is Kit's
  general-purpose segmentation primitive.
- **Form** — a signup surface (embed or hosted landing page). It also records *how* someone joined and
  carries the double opt-in setting. Adding someone to a form is how Kit attributes a subscription to a source.
- **Sequence** — an automated drip series. Adding a subscriber starts them receiving that series on a schedule.
- **Segment** — a saved dynamic filter (`GET /v4/segments`, read-only via API).

### Which one represents "signed up for Launch Tasks"?

**A tag.** Concretely: one tag, e.g. `launch-tasks-signup`.

The decisive evidence is on the broadcast side. `POST /v4/broadcasts` accepts a `subscriber_filter`, and
the spec states: *"We currently support targeting your subscribers based on segment or tag ids"* — the
filter's `type` enum is exactly `["segment", "tag"]` (https://developers.kit.com/api-reference/v4.json,
`/v4/broadcasts` POST). Kit's UI offers the same targeting. So a tag is directly and reliably usable as
"email just these physicians", which is the ticket's stated requirement.

Supporting endpoints that make a tag operationally comfortable:
- `GET /v4/tags/{tag_id}/subscribers` — list everyone with the tag, filterable by status and by
  `tagged_after`/`tagged_before` (v4.json).
- `GET /v4/subscribers/{subscriber_id}/tags` — what tags does this person have.
- Webhook events `subscriber.tag_added` / `subscriber.tag_removed`
  (https://developers.kit.com/webhooks/event-types.md).

**A form is a useful secondary, not the primary.** A form gives clean attribution and is what the Kit UI
shows as the growth source. But — see §3 — adding people to a *double opt-in* form is precisely what
triggers a confirmation email, which is the outcome we must avoid. If a form is used at all, it must have
double opt-in disabled / auto-confirm enabled.

**A sequence is wrong for v1.** Adding to a sequence starts sending drip emails. Nothing in the map says
the product has a welcome drip; the map explicitly lists "is there a welcome email?" as *not yet
specified*. Do not add to a sequence until that decision is made. (When it is, the endpoint is
`POST /v4/sequences/{sequence_id}/subscribers` with `{"email_address": "..."}`.)

---

## 3. Double opt-in — the important finding

### The short answer

**`POST /v4/subscribers` does not send a confirmation email, and creates the subscriber `active`
(i.e. confirmed and emailable) by default.**

Evidence, from the OpenAPI spec (https://developers.kit.com/api-reference/v4.json) and
https://developers.kit.com/api-reference/subscribers/create-a-subscriber:

- The `state` body field is documented as: *"Create subscriber in this state (`active`, `bounced`,
  `cancelled`, `complained` or `inactive`). **Defaults to `active`.**"*
- The endpoint's full description covers upsert semantics, custom-field rules, and the 140-field cap.
  It says nothing about a confirmation, incentive, or opt-in email. Neither does the tag endpoint
  (`POST /v4/tags/{tag_id}/subscribers`), whose description is only *"The subscriber being tagged must
  already exist."*
- The **only** place in the entire v4 OpenAPI document where an opt-in email is mentioned is the *form*
  endpoints: *"Adding subscribers to double opt-in forms will trigger sending an Incentive Email.
  Subscribers already added to the specified form will not receive the Incentive Email again."*
  (description of `POST /v4/bulk/forms/subscribers`,
  https://developers.kit.com/api-reference/forms/bulk-add-subscribers-to-forms.md).

So the confirmation email in Kit is attached to **forms with double opt-in enabled**, not to subscriber
creation. Double opt-in is a per-form setting — Kit's help centre shows the form settings "Send
confirmation email" and "Auto-confirm new subscribers"
(https://help.kit.com/en/articles/2971364-the-all-important-double-opt-in).

### `active` vs `inactive` == confirmed vs unconfirmed

Kit's help centre defines the statuses a human sees: **Confirmed** subscribers are "the only status that
receives emails"; **Unconfirmed** are those "awaiting confirmation via double opt-in" and cannot be sent
broadcasts; unconfirmed subscribers also don't count toward billing
(https://help.kit.com/en/articles/2502651-the-subscriber-profile-page-and-status,
https://help.kit.com/en/articles/4008773-why-do-i-have-unconfirmed-subscribers).

The API's `state` enum has no `unconfirmed` member — it has `inactive`. Mapping `inactive` → the UI's
"Unconfirmed" is a *strong inference*, not a documented statement: the v4 list/filter endpoints expose
exactly `active | inactive | bounced | complained | cancelled`, which lines up one-to-one with the help
centre's Confirmed / Unconfirmed / Bounced / Complained / Unsubscribed. **Flagged as unverified** — Kit
does not publish a state-name mapping table. It does not change the recommendation, because we create
with the default `active` either way.

Also note, from the same help article: *"If a subscriber hasn't confirmed their subscription themselves,
there's no option for confirming them on their behalf in your Kit account."* This is the trap to avoid.
If you ever push someone through a double opt-in form and they ignore the email, you cannot fix it
afterwards from the dashboard — they are stuck unconfirmed and unemailable.

### Is skipping double opt-in legitimate here?

Yes, and the app is in an unusually strong position: the address has already been proven by a magic link
(per `../map.md`, "Auth: magic link only. No passwords. Doubles as email verification"), and consent is an
explicit checkbox at registration. Double opt-in exists to prove address ownership and intent
(https://help.kit.com/en/articles/2971364-the-all-important-double-opt-in); the magic link already proves
ownership and the checkbox records intent. A second unexpected confirmation email would be worse than
redundant — it would look like a phishing attempt to a physician who just registered.

**Implementation consequence: create the subscriber via `POST /v4/subscribers` and tag them. Do not route
registration through a double opt-in form.** If a form is wanted for attribution, disable double opt-in on
that specific form first (verify in the Kit UI before wiring it up — *unverified by docs* whether the API
exposes the form's opt-in setting; `GET /v4/forms` returns `uid`, `embed_js`, `embed_url`,
`subscriber_count` and does not document an opt-in flag).

**Keep your own consent record.** Store the consent checkbox value, timestamp, and IP/user-agent in the
app's own SQLite DB. Kit is not a system of record for consent, and the map's "no PHI" rule does not
exempt you from being able to prove why you emailed someone.

---

## 4. Unsubscribes and sync direction

### Kit is the source of truth for subscription state

Kit handles unsubscribes itself (every broadcast carries the link). The app must not try to own this.

- `POST /v4/subscribers/{id}/unsubscribe` — the app-side equivalent. The docs are emphatic:
  *"Unsubscribes the subscriber from all future emails, moving them to the `cancelled` state. Returns
  `204 No Content` on success. The subscriber record, history, and tags are retained… **Note:** this is
  the API equivalent of the subscriber clicking unsubscribe. Treat it as consent-revoking and effectively
  permanent — only re-subscribe someone with their explicit permission."*
  (https://developers.kit.com/api-reference/v4.json, `/v4/subscribers/{id}/unsubscribe`)

  Note the consequence: **tags are retained on unsubscribe.** A tag alone is therefore not proof of
  current consent — always read `state` too. Kit will not send to a `cancelled` subscriber regardless,
  but the app's own UI must not claim "you're subscribed" based on the tag.

### Learning about it: webhooks

Webhooks are available and were substantially rebuilt recently. Per
https://developers.kit.com/changelog.md, **2026-08-27 "Webhooks 2.0"** introduced endpoint-based webhooks
with signed deliveries, batching (up to 100 events per delivery), and automatic retries over ~41 hours.
The older per-event `/v4/webhooks` resource still works but is now documented as **legacy**; the spec says
*"new integrations should be built here"* (description of `POST /v4/webhook_endpoints`).

Register with `POST /v4/webhook_endpoints`:

```json
{ "url": "https://launchtasks.directcaretools.com/webhooks/kit",
  "events": ["subscriber.unsubscribed", "subscriber.complained", "subscriber.bounced"],
  "name": "Launch Tasks sync" }
```

The `url` must be publicly reachable; private/loopback addresses are rejected. **The create response is
the only time the signing `secret` appears in plaintext** — store it, or rotate via
`POST /v4/webhook_endpoints/{id}/rotate_secret` (both from the spec).

Relevant event types (https://developers.kit.com/webhooks/event-types.md):
`subscriber.created`, `subscriber.activated`, `subscriber.unsubscribed`, `subscriber.bounced`,
`subscriber.complained`, `subscriber.subscribed_to_form`, `subscriber.added_to_sequence`,
`subscriber.sequence_completed`, `subscriber.tag_added`, `subscriber.tag_removed`,
`subscriber.custom_field_value_updated`, plus tag/sequence/broadcast/post resource events.

Signature verification (https://developers.kit.com/webhooks/verifying-signatures.md):
header `X-Kit-Signature` carries `t=<unix ts>` and one or more `v1=<hmac>` values; the signature is
HMAC-SHA256 of the string `"{t}.{raw_body}"` keyed by the endpoint secret. Reject anything older than
**300 seconds**. Compare in constant time (`crypto.timingSafeEqual`). Accept a match against *any* `v1`
so secret rotation works. **You must hash the raw request bytes** — React Router/Express JSON parsing
re-serialises the body and will break verification, so capture `await request.text()` before parsing.
Events carry a UUID `id` that is stable across retries; deduplicate on that, not on delivery ID.

### Do we actually need webhooks for v1?

Probably not, and the map's "prefer fewer moving parts" preference argues against them. The app does not
send newsletters; Kit does. If someone unsubscribes in Kit, Kit stops emailing them — nothing breaks. A
webhook only earns its place if the app wants to reflect subscription state back in its own UI
("you're subscribed to updates — [manage]"). If that is wanted, `subscriber.unsubscribed` +
`subscriber.complained` is the minimum useful set. Otherwise, a poll on demand via
`GET /v4/subscribers?email_address=<addr>&status=all` answers "is this person subscribed?" for a single
user without any inbound endpoint at all.

Note also `GET /v4/subscribers` defaults to `status=active` — you must pass `status=all` (or the specific
status) or a cancelled subscriber will simply appear to not exist (v4.json, `/v4/subscribers` GET).

---

## 5. Failure handling — Kit must never block registration

The ticket's hard requirement. The design that satisfies it:

**Kit sync is a side effect of registration, never part of the registration transaction.**

1. Registration commits to SQLite first: user, practice, consent flag + timestamp. This is the only thing
   that must succeed.
2. Enqueue a durable sync job — a row in a SQLite `kit_sync_queue` table (`email`, `first_name`,
   `attempts`, `next_attempt_at`, `last_error`, `completed_at`). SQLite plus a `setInterval` worker in the
   same container is sufficient at this scale and matches the map's single-container, no-extra-services
   posture.
3. A worker drains the queue with exponential backoff, retrying `429` and `5xx`, and giving up
   permanently on `422` (bad data — log it loudly, it is a bug).
4. The registration response never awaits the Kit call. The user sees success regardless.

Why a queue rather than fire-and-forget: if Kit is down for an hour, fire-and-forget silently loses every
address collected in that hour, and collecting these addresses is a stated reason the product exists
(per the ticket). A queue table is perhaps thirty lines of code and turns a data-loss failure into a
delayed-write failure.

Additional properties worth exploiting:

- **`POST /v4/subscribers` is an upsert** — *"Behaves as an upsert. If a subscriber with the provided
  email address does not exist, it creates one… If a subscriber with the provided email address already
  exists, it updates the first name."* (https://developers.kit.com/api-reference/subscribers/create-a-subscriber).
  `201` = created, `200` = updated. So retries are safe; there is no duplicate-subscriber risk.
- **Tagging is idempotent too** — `201` = tag applied, `200` = subscriber already had the tag
  (https://developers.kit.com/api-reference/tags/tag-a-subscriber).
- Kit documents **eventual consistency** (https://developers.kit.com/api-reference/eventual-consistency.md),
  so do not write a read-after-write assertion into the sync path.
- Set a short client timeout (5s) on the fetch. A hung Kit connection must not hold a worker slot.
- The tag must exist before it can be used. Resolve its ID once at boot via `GET /v4/tags` (or create it
  once with `POST /v4/tags` and put the ID in config). Do not look it up on every registration — that
  doubles your request count against the 120/min budget for no benefit.

---

## 6. Node SDK or plain fetch?

**Plain `fetch`. There is no official Node/TypeScript SDK.**

Surveyed the `Kit` GitHub organisation via the GitHub API (`https://api.github.com/orgs/Kit/repos`,
49 repos, checked 2026-09-16):

- `Kit/ConvertKitSDK-PHP` — "Kit official PHP SDK", actively maintained (pushed 2026-09-16).
  https://github.com/Kit/ConvertKitSDK-PHP
- `Kit/convertkit-react` — a *form embed* library for React, not an API client; last pushed **2023-03-05**,
  effectively unmaintained. https://github.com/Kit/convertkit-react
- `Kit/ConvertKitSDK-iOS` — archived since 2015.
- No JavaScript or TypeScript API client exists in the org at all.
- The `https://github.com/ConvertKit` org returns nothing (redirected/renamed to `Kit`).

The surface we need is three POSTs and one GET. A ~60-line typed module wrapping `fetch` is smaller and
more auditable than any dependency, and the published OpenAPI spec
(https://developers.kit.com/api-reference/v4.json) can generate types if desired. This also matches the
map's "minimal bloat / fewer moving parts" standing preference.

Kit does also ship an MCP server and a Cursor plugin
(https://developers.kit.com/mcp/kit-mcp.md, https://github.com/Kit/cursor-plugin) — useful for the owner
poking at their account from an editor, irrelevant to the application runtime.

---

## 7. Recommended integration approach

### One-time setup (manual, in the Kit dashboard / a one-off script)

1. Create a **V4 API key** in Kit's Developer settings. Store as `KIT_API_KEY` (server-only).
   Copy it immediately — it is shown once.
2. Create one tag, e.g. **`launch-tasks-signup`**, via the UI or `POST /v4/tags` with
   `{"name": "launch-tasks-signup"}`. Record its integer ID as `KIT_SIGNUP_TAG_ID`.
3. Do **not** create or use a double opt-in form for this path.

### At registration (after the magic link is verified and the consent box was ticked)

All requests carry `X-Kit-Api-Key: $KIT_API_KEY` and `Content-Type: application/json`.

**Step 1 — upsert the subscriber (no confirmation email, lands `active`):**

```
POST https://api.kit.com/v4/subscribers
{ "email_address": "physician@example.com", "first_name": "Jane" }
```
`201` created / `200` updated. `state` is omitted deliberately so it defaults to `active`; note the docs
say state *updates* via this endpoint are not supported, so never rely on it to resurrect a cancelled
subscriber. Response body contains `subscriber.id`.

**Step 2 — apply the tag (by email, so no ID bookkeeping is needed):**

```
POST https://api.kit.com/v4/tags/{KIT_SIGNUP_TAG_ID}/subscribers
{ "email_address": "physician@example.com" }
```
`201` tagged / `200` already tagged. (The by-ID variant
`POST /v4/tags/{tag_id}/subscribers/{subscriber_id}` also exists if you kept the ID from step 1; the
by-email form is one less thing to thread through the queue row.)

Both calls run in the background worker, never in the registration request path.

### Reading state, when needed

```
GET https://api.kit.com/v4/subscribers?email_address=physician@example.com&status=all
```
Remember `status` defaults to `active`; pass `all` or you cannot distinguish "unsubscribed" from "unknown".

### Double opt-in behaviour to expect

**None.** No confirmation email is sent. The physician receives nothing from Kit at registration; the only
email they get is the app's own magic link via Resend. They become an `active` (confirmed, billable,
emailable) subscriber immediately and will receive the owner's next broadcast targeted at the
`launch-tasks-signup` tag. This is the correct and intended outcome given the address was already verified
out-of-band.

### Later, to email just these physicians

`POST /v4/broadcasts` with
`subscriber_filter: [{ "any": [{ "type": "tag", "ids": [KIT_SIGNUP_TAG_ID] }] }]`, or simply pick the tag
in Kit's broadcast composer. The owner will almost certainly use the UI; the tag is what makes that work.

### Deliberately out of scope for v1

- **Sequences.** No welcome drip until the map's "full transactional email set" question is resolved.
- **Webhooks.** Add `subscriber.unsubscribed` + `subscriber.complained` via `POST /v4/webhook_endpoints`
  only if the app grows a UI that displays subscription state. Until then it is a public endpoint,
  a signing secret, and a replay-protection implementation for no user-visible benefit.
- **OAuth.** Only if the app ever needs to write to Kit accounts other than the owner's.

---

## 8. Explicitly unverified

1. **V3 sunset date.** Documented as deprecated, but no date is published anywhere on
   developers.kit.com or in the changelog as of 2026-09-16. Low impact — we are building on V4.
2. **`inactive` == the UI's "Unconfirmed".** Inferred from the one-to-one correspondence between the v4
   `state` enum and the help centre's status list; Kit publishes no mapping table.
3. **Rate-limit response headers.** The docs state the limits and recommend exponential backoff but do not
   document `Retry-After` or `X-RateLimit-*`. Assume absent; confirm empirically if precise backoff matters.
4. **Whether a form's double opt-in setting is readable via the API.** `GET /v4/forms` documents `uid`,
   `embed_js`, `embed_url`, and `subscriber_count`; no opt-in flag is documented. If a form is ever used,
   verify its setting in the Kit UI.
5. **Whether `POST /v4/subscribers` can reactivate a `cancelled` subscriber.** The docs say state updates
   via this endpoint "are not supported at this time", and the unsubscribe endpoint calls cancellation
   "effectively permanent". Behaviour for a re-registering previously-unsubscribed physician is therefore
   undefined by the docs — treat their address as un-emailable and do not attempt to force it.
6. **Plan eligibility.** The overview notes API access requires "an authenticated account's plan [that] is
   eligible for use with the API". The owner's specific Kit plan was not checked
   (https://developers.kit.com/api-reference/overview.md).

---

## Sources

- https://developers.kit.com/api-reference/overview.md
- https://developers.kit.com/api-reference/authentication.md
- https://developers.kit.com/api-reference/response-codes.md
- https://developers.kit.com/api-reference/upgrading-to-v4.md
- https://developers.kit.com/api-reference/eventual-consistency.md
- https://developers.kit.com/api-reference/subscribers/create-a-subscriber
- https://developers.kit.com/api-reference/tags/tag-a-subscriber
- https://developers.kit.com/api-reference/forms/add-subscriber-to-form
- https://developers.kit.com/api-reference/forms/bulk-add-subscribers-to-forms.md
- https://developers.kit.com/api-reference/v4.json (official OpenAPI 3.0.3 spec, Kit API 4.0)
- https://developers.kit.com/webhooks/event-types.md
- https://developers.kit.com/webhooks/verifying-signatures.md
- https://developers.kit.com/changelog.md
- https://developers.kit.com/llms.txt
- https://help.kit.com/en/articles/2971364-the-all-important-double-opt-in
- https://help.kit.com/en/articles/2502651-the-subscriber-profile-page-and-status
- https://help.kit.com/en/articles/4008773-why-do-i-have-unconfirmed-subscribers
- https://github.com/Kit/ConvertKitSDK-PHP
- https://github.com/Kit/convertkit-react
- https://api.github.com/orgs/Kit/repos (repo inventory, retrieved 2026-09-16)
