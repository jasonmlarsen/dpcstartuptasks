# What Kit v4 actually does to a cancelled subscriber

Probed live against the Direct Care Tools account on 2026-09-18, resolving the
factual half of [#15](https://github.com/jasonmlarsen/dpcstartuptasks/issues/15).
Scripts: `.scratch/launch-tasks/wizards/kit-unsubscribe-probe.sh` and
`…-probe-2.sh`. Raw responses are gitignored (they carry a live address).

## The headline

**Kit does not defend a cancelled subscriber against writes. We have to.**

`POST /v4/subscribers/{id}/unsubscribe` moves the record to `state: "cancelled"`
and it stays there — no write path tested resurrected it. But every write was
*accepted*, and each returned a normal-looking `200` with a full subscriber
object:

| Write against a `cancelled` subscriber | Result |
| --- | --- |
| `POST /v4/subscribers` (same address) | Accepted. `state` stayed `cancelled` — **but `first_name` went `Probe`→`ProbeTwo` and `practice_state` went `TX`→`CA`.** |
| `PUT /v4/subscribers/{id}` with `fields` | Accepted in full. `practice_state` → `NV`. `state` unchanged. |
| `POST /v4/tags/{id}/subscribers` | Accepted. `state` unchanged. |

So the naive re-registration path is **worse than the docs suggest**. The ticket
predicted the re-POST would "probably do nothing, silently." It does something:
it quietly maintains a profile on someone who asked us to stop, and reports
success while doing it.

## Tags survive unsubscribe

The re-tag call returned `tagged_at` as the *original* timestamp — the tag was
never removed by the unsubscribe. This confirms `kit-sync.md` §4: **a tag is not
proof of current consent.** Always read `state`.

## `status=all` is the safety check, not a detail

Two reads of the same cancelled address, differing only in that parameter:

```
GET /v4/subscribers?email_address=<enc>&status=all  → the subscriber, state "cancelled"
GET /v4/subscribers?email_address=<enc>             → { "subscribers": [] }
```

A worker that omits `status=all` does not merely miss a field. It sees an empty
array, concludes the address is new, and POSTs — **writing through the wall by
way of a check that was supposed to prevent exactly that.** The parameter is
load-bearing.

`GET /v4/subscribers/{id}` needs no parameter, returns the same `state`, and
additionally carries `canceled_at` (note Kit's single-l spelling) which the list
response omits. Prefer it wherever a `subscriber.id` has been persisted, per
[#13](https://github.com/jasonmlarsen/dpcstartuptasks/issues/13).

## Percent-encode the address, always

Probe 1 lost all five of its read-backs to one bug worth keeping as a
requirement: `larsen.ideas+test2@gmail.com` interpolated raw into a query string
arrives at Kit with the `+` decoded as a space, and Kit answers:

```json
{"errors":["email_address contains an invalid email address"]}
```

Plus-addressing is common among physicians using a personal Gmail. The failure
mode is nasty in exactly the wrong direction: a worker that treats a non-2xx
read as "no subscriber found" will proceed to write. Encode the address, and
treat a read error as *unknown*, never as *absent*.

## Resubscribing is not an API operation

`state` is documented create-only (*"Updating the subscriber state with this
endpoint is not supported at this time"*), and nothing observed contradicts
that. The only legitimate path back is a **Kit-hosted form**.

`GET /v4/forms` returns `200` on this (free) plan with four existing forms, each
carrying a linkable `embed_url` of the form
`https://directcaretools.kit.com/<uid>`. None is a resubscribe form; one must be
provisioned. Kit's double opt-in on that form is desirable here — the
confirmation email *is* the explicit permission Kit's own docs require before
re-subscribing anyone.

## Consequences for the sync worker

1. Every job that writes reads `state` first — by id where one is persisted,
   otherwise by percent-encoded address **with `status=all`**.
2. `cancelled` → write nothing at all. Not the subscriber, not the tag, not the
   field.
3. That job **succeeds** with an outcome of `suppressed`; it is not a failure and
   must never be retried or dead-lettered.
4. Re-check `state` on each write's own response — it is already in the body — to
   catch an unsubscribe that landed between the read and the write.
