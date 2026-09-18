# Research: custom subscriber fields in Kit v4

Ticket: [#13](https://github.com/jasonmlarsen/dpcstartuptasks/issues/13) — resolving the assumption left
standing by [#6](https://github.com/jasonmlarsen/dpcstartuptasks/issues/6) (the Practice's state syncs to
Kit as a **custom field**, not as one of 50 tags) and unverified by
[#9](https://github.com/jasonmlarsen/dpcstartuptasks/issues/9).
Researched: 2026-09-18
Primary sources: `developers.kit.com` — the published OpenAPI spec at
`https://developers.kit.com/api-reference/v4.json`, read directly rather than through the rendered pages,
plus the endpoint `.md` pages and `help.kit.com` for the parts of Kit that only exist in the UI.
No third-party blogs or tutorials were used for factual claims.

Prior findings this builds on: [`kit-sync.md`](./kit-sync.md) — auth (`X-Kit-Api-Key`), plain `fetch`,
no maintained Node SDK, queue-drained worker, 120 req/rolling-60s on an API key.

---

## Verdict up front

**#6's field-not-tag decision survives, with one correction to how the segmentation actually happens.**

Custom fields are real, first-class, writable at creation, updatable afterwards, and genuinely filterable.
But a broadcast cannot point at a custom field directly — `subscriber_filter` accepts **only** `segment`
and `tag` ids. The custom field is reachable for broadcasts *through a Segment*: the Owner builds a
Segment in the Kit app whose condition is the custom field's value, and targets that Segment. That is one
Segment per state the Owner ever actually wants to mail — created on demand, in the UI, by a human — not
50 tags written by our code on every sync. The decision holds; the mechanism has one more hop in it than
#6 implies, and that hop is manual and lazy rather than automated and eager.

There is also **one genuine contradiction inside Kit's own spec** about what happens when you write an
unknown field key — see §2. It changes what the worker must check.

---

## 1. Does v4 support custom fields, and can one be set at creation?

**Yes, and yes — `POST /v4/subscribers` takes them in the same request that creates the subscriber.**

The create-subscriber request body has a `fields` property alongside `first_name` and `email_address`
(https://developers.kit.com/api-reference/v4.json, `/v4/subscribers` POST):

> `fields` — *"Custom field values keyed by the custom field's `key` (e.g. `last_name`, not `Last Name`).
> Unknown keys are ignored and reported in the response `warnings` array."*

`additionalProperties: { "type": "string" }` — **every value is a string.** There is no typed field
system: no enum type, no integer type, no date type. A state is stored as the string `"TX"`. The numeric
comparison operators that exist elsewhere (§5) parse the stored string as a number at query time; they do
not imply a numeric column.

The spec's own example for this endpoint sends fourteen fields at creation, including `postal_code` and
`how_did_you_hear_about_us` — i.e. exactly our shape of use.

The surface, from the endpoint inventory in `v4.json`:

| Endpoint | Method | Auth | What it does |
|---|---|---|---|
| `/v4/custom_fields` | GET | API key or OAuth | List the account's fields — `id`, `name`, `key`, `label` |
| `/v4/custom_fields` | POST | API key or OAuth | Create a field from a `label` |
| `/v4/custom_fields/{id}` | PUT | API key or OAuth | Rename a field's label |
| `/v4/custom_fields/{id}` | DELETE | API key or OAuth | Delete it — *"This will remove all data in this field from your subscribers."* |
| `/v4/subscribers` | POST | API key or OAuth | Upsert a subscriber **with** `fields` |
| `/v4/subscribers/{id}` | PUT | API key or OAuth | Update a subscriber's `first_name`, `email_address`, **and `fields`** |
| `/v4/subscribers/{id}` | GET | API key or OAuth | Read one subscriber, values under `fields` |
| `/v4/subscribers` | GET | API key or OAuth | List; `slim=true` **omits** `fields` |
| `/v4/subscribers/filter` | POST | API key or OAuth | Filter subscribers, **including by custom field value** (§5) |
| `/v4/bulk/custom_fields` | POST | **OAuth only** | Bulk-create fields |
| `/v4/bulk/custom_fields/subscribers` | POST | **OAuth only** | Bulk-set values by `subscriber_custom_field_id` |

**Both bulk endpoints are OAuth-only** (`security: [{OAuth2: []}]` in `v4.json`, and the bulk-values
description says flatly *"Requires OAuth authentication."*). We authenticate with an API key, so **both
are closed to us**. This does not hurt: our queue worker writes one subscriber at a time anyway, and the
per-subscriber endpoints take an API key. It only matters if a backfill is ever wanted — a backfill would
be a loop over `PUT /v4/subscribers/{id}`, throttled against the 120/min budget, not one bulk call.

A cap applies to both write paths: *"We support creating/updating a maximum of 140 custom fields at a
time."* We send one. Irrelevant, noted for completeness.

---

## 2. Must the field exist first? — yes, and the docs disagree with themselves about the failure mode

**Yes. The field must be provisioned on the account before any subscriber write can set it. Writing an
unknown key does not create it.** Both write endpoints say so in identical words
(https://developers.kit.com/api-reference/subscribers/create-a-subscriber.md,
https://developers.kit.com/api-reference/subscribers/update-a-subscriber.md):

> *"If you include a custom field key that does not exist on your account, the request returns an error.
> Use [List custom fields] to retrieve existing keys, or [Create a custom field] to add new fields before
> setting them for subscribers."*

That much is unambiguous and is the answer to the question as asked.

### The contradiction

The same spec document says two different things about what an unknown key *does*:

- The endpoint **description** (quoted above): *"the request returns an error."*
- The `fields` **property description**, and the `201` **response schema**: the key is silently ignored.
  The response schema's `warnings` array is documented as: *"Present only when the request referenced
  custom field keys that don't exist on the account. Each entry names an unknown key that was ignored;
  **the subscriber is still created or updated**."*

These cannot both be true. The machine-readable half of the spec (the request-property description and
the response schema, which are what the API is actually generated from) is the more credible of the two,
and it says **silent partial success**: `201`/`200`, subscriber written, field quietly dropped, a string
in `warnings` as the only evidence. The prose sentence reads like stale copy from an earlier behaviour.

**This is not an academic distinction.** Under the prose reading, a typo in the field key fails loudly and
the queue row retries and then dead-letters with a `422` we would notice. Under the schema reading — the
likelier one — a typo means every Practice's state silently never arrives in Kit, every sync reports
success, and the first symptom is the Owner finding an empty Segment months later.

**Implementation consequence, and it is cheap:** the worker must treat a non-empty `warnings` array in a
`2xx` response as a **failure**. Log it loudly and fail the job permanently (it is a deploy-time bug, not
a transient one — retrying will not make the field exist). Do not let a `2xx` alone mean success on any
request that carried `fields`.

### What the provisioning step actually is

The field must pre-exist, but **it does not have to be created by hand** — `POST /v4/custom_fields` takes
an API key, and its responses are documented as:

> `200` — *"Returns a 200 and the custom field if it already exists"*
> `201` — *"Creates a new custom field and returns its details"*

So creation is **idempotent**, exactly like tag creation in `kit-sync.md` §7. Three options, in order of
preference:

1. **A one-off provisioning script** (recommended) — `POST /v4/custom_fields` with `{"label": "State"}`,
   run once against the live account, alongside the `launch-tasks-signup` tag creation from
   `kit-sync.md`. Idempotent, so safe to re-run; scriptable, so the setup is in the repo and not in
   somebody's memory. This is the step this effort owns.
2. **By hand in the Kit UI** — per https://help.kit.com/en/articles/2502504-how-to-add-and-manage-custom-fields,
   Subscribers → open any subscriber's profile → *"Click the greater-than icon (>) next to **Custom
   Fields** in the left sidebar. Then, click the `+` button to add a new custom field."* Worth knowing
   because the Owner may well do it this way, and worth knowing that adding a field is account-wide:
   *"they'll appear for every subscriber in your account."*
3. **At boot, from the app.** Rejected. It spends a request on every deploy to assert something that
   changes once, and it means the app holds a permission it needs for ten seconds of its life.

### The `label` / `key` / `name` distinction — the actual trap

`POST /v4/custom_fields` takes only a **`label`**. Kit derives the other two
(https://developers.kit.com/api-reference/v4.json, `/v4/custom_fields` POST):

> *"Additionally, a `key` field and a `name` field will be generated for you. The `key` is an ASCII-only,
> lowercased, underscored representation of your label. This key must be unique to your account. Keys are
> used in personalization tags in sequences and broadcasts. Names are unique identifiers for use in the
> HTML of custom forms. They are made up of a combination of ID and the key of the custom field prefixed
> with `ck_field`."*

The spec's own example: `label: "Interests"` → `key: "interests"`, `name: "ck_field_6_interests"`, `id: 6`.

Three consequences, all load-bearing:

- **`fields` on a subscriber write is keyed by `key`, not `label`.** The property description spells it
  out: *"(e.g. `last_name`, not `Last Name`)"*. Label `"State"` gives key `"state"`.
- **Do not hardcode the derived key on faith.** Run the provisioning script, read the `key` out of the
  response, and put *that* in config (`KIT_STATE_FIELD_KEY`). The derivation rule is documented but the
  uniqueness constraint means Kit could hand you something else if a colliding key already exists on the
  account — and a wrong key now fails silently (see the contradiction above).
- **Renaming the label later changes the key and breaks things.** `PUT /v4/custom_fields/{id}`:
  > *"Note that the key will change but the name remains the same when the label is updated.
  > **Warning:** An update to a custom field will break all of the liquid personalization tags in emails
  > that reference it — e.g. if you update a `Zip_Code` custom field to `Post_Code`, all liquid tags
  > referencing `{{ subscriber.Zip_Code }}` would no longer work and need to be replaced with
  > `{{ subscriber.Post_Code }}`."*

  It would also break **our** writes, since we send the key. Renaming the field in the Kit UI is therefore
  a breaking change to the integration, silently. Worth a line in whatever runbook covers the Kit account.

**Name suggestion: label `State`, key `state`.** Note the collision with our own vocabulary — Kit already
has a subscriber `state` (`active`/`cancelled`/…) which means something completely different and which
`kit-sync.md` §4 leans on. In the Kit API response a subscriber carries both `state` (lifecycle) and
`fields.state` (Texas). They are distinguishable but adjacent, and a reader will conflate them. Consider
label **`Practice State`** → key `practice_state`, which also matches CONTEXT.md's vocabulary (it is the
*Practice's* state, recorded in the Practice Profile, not the User's). Cheap to decide now, breaking to
change later.

---

## 3. Which write path updates an existing subscriber's field?

The Owner syncs twice: once at registration (address + consent, no state yet — the Tailoring Wizard has
not run) and once at wizard completion (state now known). The second must update, not duplicate.

**Use `PUT /v4/subscribers/{id}`.** Its request body carries `fields`, and it is the only single-subscriber
endpoint whose documented purpose is updating.

Duplication is not a risk on either path — `kit-sync.md` §5 already established that `POST /v4/subscribers`
is an upsert keyed on email address, `201` created / `200` updated. So the question is not "will it
duplicate" but "will it actually write the field".

### Why not just re-POST to `/v4/subscribers`?

Because the docs are ambiguous about whether the upsert's *update* branch writes `fields` at all:

> *"Behaves as an upsert. If a subscriber with the provided email address does not exist, it creates one
> with the specified first name and state. **If a subscriber with the provided email address already
> exists, it updates the first name.**"*

"Updates the first name" — `fields` is conspicuously not mentioned in the update branch, even though it is
mentioned for creation. Compounding it, the documented `200` (already-exists) response schema types
`fields` as `{"type": "object", "properties": {}}` — an empty shape — while the `201` (created) schema
types it as `additionalProperties: {type: string}` with a real description. That asymmetry may be sloppy
schema authoring, or it may be the API telling the truth about what the update branch does.

**Unverified, and deliberately routed around.** `PUT /v4/subscribers/{id}` documents `fields` without
qualification on a request whose entire job is updating. Use it.

### The shape of the two syncs

**Sync 1 — registration** (unchanged from `kit-sync.md` §7, plus store the id):

```
POST /v4/subscribers            { "email_address": "...", "first_name": "..." }
POST /v4/tags/{id}/subscribers  { "email_address": "..." }
```

**Persist `subscriber.id` from the response into the app's own DB.** This is the one change #13 forces on
#9's design. The PUT path is by-id — there is no by-email update endpoint in v4 — so without the stored id
the second sync has to spend an extra `GET /v4/subscribers?email_address=…&status=all` to find it, on
every wizard completion, forever. Store it once; it is an integer on a row that already exists.

**Sync 2 — wizard completion:**

```
PUT /v4/subscribers/{subscriber_id}
{ "email_address": "physician@example.com", "fields": { "practice_state": "TX" } }
```

`email_address` is `required` on the PUT body even though it is not what you are changing — send the
address you already hold, unchanged. Do not send `first_name` unless you mean to set it; it is nullable,
and it is not worth discovering empirically whether omitting it and nulling it are distinguishable.

**If the stored id is missing** (a Practice registered before this field existed, or a lost row), fall back
to `GET /v4/subscribers?email_address=…&status=all` — remembering from `kit-sync.md` §4 that `status`
defaults to `active` and will make a cancelled subscriber look nonexistent — then PUT. Do not fall back
to `POST /v4/subscribers` and hope, given the ambiguity above.

### Retries and ordering

- **PUT is idempotent by nature.** Setting `practice_state` to `"TX"` twice leaves `"TX"`. Safe to retry
  on `429`/`5xx` exactly as `kit-sync.md` §5 prescribes.
- **The two syncs must not race.** Sync 2 needs the subscriber to exist, which is sync 1's job, and
  `kit-sync.md` cites Kit's own https://developers.kit.com/api-reference/eventual-consistency.md. In
  practice a wizard completion is minutes behind a registration, so this is nearly theoretical — but a
  retried-and-delayed sync 1 could in principle still be pending. Since the queue row for sync 2 carries
  the subscriber id, the ordering is enforced for free: **no id in the app's DB yet means sync 1 has not
  succeeded, so defer sync 2** rather than fabricating a lookup. A `404` from the PUT is the same signal —
  reschedule, do not dead-letter.
- A Practice whose Owner skips the Tailoring Wizard never gets a sync-2 job at all. Their subscriber
  simply has no value for the field, which `has_value` (§5) can distinguish from any state.

### Rate limits against the queue worker

Unchanged from `kit-sync.md` §1 — **120 requests / rolling 60s per API key**, with Kit advising
*"performing an exponential backoff to keep within the limit"* and no documented `Retry-After` or
`X-RateLimit-*` headers (https://developers.kit.com/api-reference/response-codes.md). #13 adds **at most
one request per Practice** (the wizard-completion PUT) on top of #9's two. Three requests per Practice
against 7,200/hour, at ~50 Practices in six months, is not a constraint. The only path that could
approach it is a bulk backfill, which — since the bulk endpoints are OAuth-only and closed to us — would
be a throttled loop of PUTs and must be written deliberately with a sleep in it.

---

## 4. Does updating a field re-trigger anything?

**No confirmation email, no incentive email, no double opt-in. But it can trigger an automation, and it
does emit a webhook.**

### Email: nothing

`kit-sync.md` §3 established that in v4 the opt-in/incentive email is attached to **forms with double
opt-in enabled**, and nowhere else — the only mention of an opt-in email in the entire v4 OpenAPI document
is on `POST /v4/bulk/forms/subscribers`. That finding re-checked and still holds: neither
`/v4/subscribers` POST, `/v4/subscribers/{id}` PUT, nor any `/v4/custom_fields` endpoint mentions an email
of any kind. A custom field write touches no form, so it cannot trigger a form's opt-in email.

Nor can it disturb subscription state. `state` is not even a property of the PUT request body (compare
POST, where it exists but is documented as create-only: *"Updating the subscriber state with this endpoint
is not supported at this time"*). There is no path by which writing `practice_state` moves anyone out of
`active`.

### Automations: yes, and this is the real answer to the question

**A custom field change is a first-class Visual Automation entry point in Kit.** Per
https://help.kit.com/en/articles/2502666-how-to-use-kit-visual-automations, an automation can start:

> *"When a subscriber joins a certain Form or Landing Page (or any Form or Landing Page) — When a certain
> Tag is added to a subscriber — **When there is a change to a subscriber's custom field value** — When a
> subscriber purchases a certain product"*

And https://help.kit.com/en/articles/2502670-visual-automations-events describes the same as an event,
configurable either as *"when the custom field changes to a specific value"* or, by switching the trigger
from "changes to" to "changes", *"if any changes at all are made to this custom field, they will jump to
this point in the automation."*

So the honest answer to "does updating a field re-trigger anything" is: **not by default, but it is an
available trigger, which means the Owner can arm one from the Kit UI without telling us.** Our sync-2 PUT
is a custom field change and will fire any such automation. That is a feature — "when Practice State
changes to TX, start the Texas sequence" is a reasonable thing for the Owner to want — but it means the
app has a trigger surface in someone else's dashboard. Two things follow:

- **Do not write the field more often than it changes.** If the wizard is ever re-openable, or if any
  future code path re-syncs the Practice Profile on a schedule, each write is a potential automation entry.
  Write on wizard completion and on genuine change, not on every save.
- **Whether re-writing the *same* value counts as a "change" is undocumented — see §6.** Assume the worst
  (that it does fire) and let the app's own dirty-checking be the guard, rather than relying on Kit to
  de-duplicate.

### Webhooks: yes

`subscriber.custom_field_value_updated` is listed as **Available** (not merely planned) in
https://developers.kit.com/webhooks/event-types.md. Its payload carries the `subscriber` object including
`fields`. There is also a resource-level `custom_field.created` / `custom_field.deleted` pair.

Per `kit-sync.md` §4 we are not registering a webhook endpoint for v1, so this costs nothing today. Noted
because it is the natural thing to reach for if the app ever needs to know that the Owner edited the state
by hand in Kit — and because it confirms Kit treats a field write as a real, observable state change.

---

## 5. Can broadcasts and segments actually filter on a custom field?

**Segments: yes. Broadcasts: yes, but only *through* a Segment — never on the field directly.** This is
the one place #6's mental model needs correcting.

### Broadcast targeting is tags and segments only

`POST /v4/broadcasts` (https://developers.kit.com/api-reference/v4.json) is explicit:

> *"We currently support targeting your subscribers based on segment or tag ids."*

and the `subscriber_filter` schema backs it up — under each of `all` / `any` / `none`, the condition object
is `{ type, ids }` where `type` is an enum of exactly `["segment", "tag"]` and `ids` is an array of
integers. There is **no** custom-field condition, on any of the three groups. (The same sentence appears on
`PUT /v4/broadcasts/{id}`.) A further limit worth knowing: *"At this time, we only support using only one
filter group type via the API (e.g. `all`, `any`, or `none` but no combinations)."*

Taken alone that sentence is what would sink #6. It does not, because of what a Segment is.

### A Segment can be built on a custom field

Kit's help centre, on using custom fields for survey answers
(https://help.kit.com/en/articles/5434217-how-to-survey-subscribers-using-custom-fields-in-kit):

> *"Once you've started getting survey responses, you can **create a Segment** to group subscribers who
> have the same custom field value."*

Segments are **UI-only as far as the API is concerned** — `GET /v4/segments` is read-only and says so:

> *"Segments are created and managed in the Kit app — the API doesn't currently support creating or
> updating them. Use segment ids for targeting, for example in a broadcast's `subscriber_filter`."*

So the working chain is:

```
our PUT writes fields.practice_state = "TX"
    → Owner creates a Segment in the Kit app: practice_state is "TX"       (manual, once, per state)
    → broadcast targets that segment id  (UI dropdown, or subscriber_filter type "segment")
```

The Owner does this by hand, in the Kit app, for the states they actually want to mail. That is the
correct division of labour: **our code writes data; the Owner decides how to slice it.** Fifty state tags
would have inverted that — our code deciding, eagerly, that all fifty slices matter, and writing fifty
labels into the Owner's tag list forever.

### The API can filter on a custom field directly, too

Separately from broadcasts, `POST /v4/subscribers/filter` — *"Filter subscribers by engagement, sign-up
date, state, and tags"*, despite the summary — has a `custom_field` condition type in its `FilterCondition`
schema. The condition types are:

`opens`, `clicks`, `sent`, `delivered`, `subscribed`, `subscriber_state`, `tags`, `attribution`,
**`custom_field`**, `location`

> *"`custom_field` matches subscribers by the value they have stored for a particular custom field,
> identified by `subscriber_custom_field_id`."*

It takes `subscriber_custom_field_id` (the integer from `/v4/custom_fields`, not the key), a `value`, and a
`comparison` from:

> *"`is` is exact equality, `contains` is a case-insensitive substring (blank `value` matches any
> subscriber that has a value stored for the field), `has_value` matches any non-empty stored value
> (ignores `value`), `greater_than` / `greater_than_or_equal` / `less_than` / `less_than_or_equal` compare
> numerically."*

Conditions in the `all` array are ANDed. So `subscriber_state: ["active"]` AND `tags: [signup tag]` AND
`custom_field: practice_state is "TX"` is one API call — a precise, verifiable answer to *"how many active
consented physicians in Texas do we have?"* without a Segment existing at all. Add
`include: [{"type": "custom_fields"}]` to get the values back on each row (*"adds a `fields` object with
all account custom field values (null for fields the subscriber has not set)"*).

This is a genuinely useful escape hatch: it means the *data* is queryable by us programmatically even
though *broadcast targeting* is not. It is how you would sanity-check that the sync is working, and how
you would count before asking the Owner to build a Segment.

### Also: the field is usable in email copy

`POST /v4/custom_fields` notes that *"Keys are used in personalization tags in sequences and broadcasts"*,
i.e. Liquid `{{ subscriber.practice_state }}`. And
https://help.kit.com/en/articles/2502665-visual-automations-conditions confirms **Custom field Conditions**
as one of four condition types for branching inside an automation, with "matches", "contains", and numeric
comparisons. So a single broadcast can also be *personalised* per state without being *segmented* per
state — arguably the better tool for "your state's requirements" copy, and impossible with tags.

### Does #6's decision survive?

**Yes.** Restated accurately:

- The state is written as a custom field value by our worker. One field, one write, one string.
- Segmentation for broadcasts goes through a Segment the Owner creates in Kit, per state, on demand. Kit's
  own docs describe this as the intended use of custom fields.
- Programmatic counting and querying by state is available directly via `POST /v4/subscribers/filter`.
- Personalisation by state in email copy is available via Liquid, which tags could not do.

The one thing #6 should absorb: **"Kit segments on fields" is true, but a broadcast targets a Segment, not
a field.** If anyone expected to pass a state into `subscriber_filter` from code, they cannot. If the Owner
ever wants all fifty states mailable without touching the Kit UI, that is fifty hand-built Segments — at
which point tags would genuinely have been simpler. Nothing in the map suggests that is the plan; the plan
is occasional state-specific mail to a handful of states, and for that the field is right.

---

## 6. Explicitly unverified

1. **The unknown-key contradiction (§2).** Kit's spec says both *"the request returns an error"* and
   *"unknown keys are ignored … the subscriber is still created or updated"*. Resolvable in ten seconds
   against the live account once the API key exists — POST a subscriber with a deliberately bogus field
   key and look at the status code and `warnings`. **Do this before writing the worker's success check**,
   and write the check to treat non-empty `warnings` as failure either way.
2. **Whether `POST /v4/subscribers` writes `fields` on the update branch (§3).** The description mentions
   only the first name; the `200` response schema types `fields` as an empty object while the `201` types
   it properly. Routed around by using `PUT /v4/subscribers/{id}`, so this never needs answering — but it
   is why the PUT is used, and if anyone later "simplifies" back to a single POST they need to test it.
3. **Whether writing the *same* value re-fires the "custom field changes" automation trigger (§4).** Kit
   documents the trigger but not its idempotency. Assume it fires; guard on our side.
4. **What the derived `key` will actually be for our chosen label (§2).** The derivation rule is
   documented and the example is consistent, but keys must be unique per account, so a collision on an
   account that already has a similar field could produce something else. Read the `key` out of the
   provisioning response rather than assuming it.
5. **Exactly which condition types Kit's Segment builder UI offers.** The survey help article states
   plainly that a Segment can group *"subscribers who have the same custom field value"*, and the API's
   own `custom_field` filter condition shows the capability exists in the data layer — but
   https://help.kit.com/en/articles/2577659-how-to-create-a-segment does not enumerate the builder's
   condition list, so the exact wording and operators the Owner will see in the dropdown are unconfirmed.
   The capability is verified; the screenshot-level detail is not. Confirm in the account before promising
   the Owner a specific workflow.
6. **Plan eligibility for Segments.** `kit-sync.md` §8 already flags that API access depends on the
   account's plan. Segments are additionally a feature Kit has historically gated by plan tier — and
   https://help.kit.com/en/articles/9053626-visual-automations-on-the-newsletter-plan shows Kit does limit
   automation features by plan. **Not checked against the Owner's actual plan.** Since the whole
   broadcast-targeting path in §5 runs through Segments, this is the single most load-bearing unverified
   item in this document: if the Owner's plan cannot create Segments, the field is still writable and
   still queryable via `/v4/subscribers/filter`, but it is **not** broadcast-targetable, and #6 would have
   to fall back to tags after all. Verify in the account before building on it.
7. **Whether deleting a custom field is recoverable.** It says *"This will remove all data in this field
   from your subscribers"*; nothing suggests it is. Treat `DELETE /v4/custom_fields/{id}` as destructive
   and never call it from application code.

---

## 7. What this changes for the implementation

Against the plan in `kit-sync.md` §7:

**One-time setup, additive:**

3. Create the custom field once — `POST /v4/custom_fields` with `{"label": "Practice State"}` — in the
   same provisioning script as the `launch-tasks-signup` tag. Record the returned `key` as
   `KIT_STATE_FIELD_KEY` and the returned `id` as `KIT_STATE_FIELD_ID` (the id is needed only for
   `/v4/subscribers/filter`, which takes the id rather than the key). Idempotent — `200` if it already
   exists.

**At registration, changed:**

- Persist `subscriber.id` from the `POST /v4/subscribers` response onto the Practice row. Sync 2 needs it.

**At wizard completion, new:**

- Enqueue a second job type. `PUT /v4/subscribers/{subscriber_id}` with
  `{"email_address": …, "fields": {"practice_state": "TX"}}`.
- Defer (do not dead-letter) if the subscriber id is not yet known, or on a `404`.
- **Treat a non-empty `warnings` array in the response as a permanent failure**, not a success.

**Unchanged:** auth via `X-Kit-Api-Key`, plain `fetch`, the queue table and worker, exponential backoff,
`422` is permanent, 5s client timeout, no read-after-write assertions.

**For the Owner, outside the code:** to mail one state, build a Segment in the Kit app filtering on
Practice State, then target that Segment. Nothing in the app does this for them, and nothing should.

---

## Sources

- https://developers.kit.com/api-reference/v4.json (official OpenAPI 3.0.3 spec, Kit API 4.0 — retrieved 2026-09-18; the `/v4/custom_fields`, `/v4/subscribers`, `/v4/subscribers/{id}`, `/v4/subscribers/filter`, `/v4/broadcasts`, `/v4/segments`, `/v4/bulk/custom_fields`, `/v4/bulk/custom_fields/subscribers` operations and the `FilterCondition` / `SubscriberFilterRequest` schemas)
- https://developers.kit.com/llms.txt
- https://developers.kit.com/api-reference/subscribers/create-a-subscriber.md
- https://developers.kit.com/api-reference/subscribers/update-a-subscriber.md
- https://developers.kit.com/api-reference/custom-fields/list-custom-fields.md
- https://developers.kit.com/api-reference/custom-fields/create-a-custom-field.md
- https://developers.kit.com/api-reference/custom-fields/update-a-custom-field.md
- https://developers.kit.com/api-reference/custom-fields/delete-custom-field.md
- https://developers.kit.com/api-reference/custom-fields/bulk-create-custom-fields.md
- https://developers.kit.com/api-reference/custom-fields/bulk-update-subscriber-custom-field-values.md
- https://developers.kit.com/api-reference/response-codes.md
- https://developers.kit.com/api-reference/eventual-consistency.md
- https://developers.kit.com/webhooks/event-types.md
- https://help.kit.com/en/articles/2502504-how-to-add-and-manage-custom-fields
- https://help.kit.com/en/articles/5434217-how-to-survey-subscribers-using-custom-fields-in-kit
- https://help.kit.com/en/articles/2577659-how-to-create-a-segment
- https://help.kit.com/en/articles/2502666-how-to-use-kit-visual-automations
- https://help.kit.com/en/articles/2502670-visual-automations-events
- https://help.kit.com/en/articles/2502665-visual-automations-conditions
- https://help.kit.com/en/articles/9053626-visual-automations-on-the-newsletter-plan
- `./kit-sync.md` (findings from #9 — auth, rate limits, upsert semantics, double opt-in, queue design)
