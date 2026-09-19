# Testing

**There are four seams, and no fifth.** They are the house style, settled in the
spec's Testing Decisions section before any code existed and established by the
scaffolding ticket. A later session that needs a new kind of test almost
certainly needs one of these four; adding a fifth is a decision, not a
convenience, and belongs in an ADR.

## What makes a good test here

A test asserts what a **physician, a Member or the Admin can observe** — the
rendered page, the redirect, the row in the database, the email that was sent,
the request that went to Kit. It never asserts that a particular function was
called, and it never reaches into a module to read a private value. When a test
fails, the failure should read as *the product does the wrong thing*, not *the
code is shaped differently*.

Three properties of this system make that cheap, and they are why the seams are
so few:

- **Zero client JS on every load-bearing path.** Sign-in, the Continue Screen,
  invite acceptance and every Status change are plain forms posting to actions.
  Dispatching a `Request` and reading a `Response` tests the real thing.
- **SQLite is a file** (ADR-0005). A fresh database per test is a file in a temp
  directory. There is no fixture framework and no shared state to reset.
- **Task Entries are eager** (ADR-0003), so a test never has to construct the
  "row doesn't exist yet" case, because that case does not exist.

## 1. The request seam — the primary seam, and the default

`test/harness.ts` → `createTestApp()`

Builds the app's real request handler over a fresh SQLite file, dispatches a
`Request`, returns a `Response`, and carries cookies between calls so a test can
sign in and stay signed in. Assertions go on status, redirect target, rendered
text, and rows in the database afterwards.

**Still owed:** the settled shape is a fresh file *seeded from the cleaned CSV*.
Today the harness only migrates, because the Seed Script (seam 4) does not exist
yet. The ticket that builds it seeds here too, and every test written afterwards
gets the 98 Tasks and 11 Phases without asking.

```ts
const app = createTestApp();
onTestFinished(() => app.close());

const response = await app.fetch("/health");
expect(await response.text()).toContain("LAUNCH_TASKS_OK");
```

**Reach for this first, and for almost everything**: the sign-in flow including
`GET`-does-nothing and `POST`-consumes; enumeration and the byte-identical
*check your email* page; both rate-limiting axes; tenancy; the three-person cap
with pending Invites counted; invite acceptance; Status changes and auto-sort
ordering; Notes; Newly Added; Retire's split behaviour; Draft invisibility; the
Tailoring Wizard; Leaving and the Grace Period; every admin screen; and Support
View end to end.

ADR-0004's two mandatory tests live here: *request → email → verify → session*
reads the Sign-in Link out of the fake sender and posts it, and the revocation
test removes a Member and asserts their next request is unauthenticated.

## 2. The outbound dependency boundary — Resend and Kit as injected clients

`app/services/email-sender.ts`, `app/services/kit-client.ts`
→ `test/fakes/fake-email-sender.ts`, `test/fakes/fake-kit-client.ts`

Not a test entry point but the thing that makes seam 1 possible. One
`EmailSender` interface and one `KitClient` interface, passed in through
`AppServices` rather than imported, each with an in-memory fake that records
calls and returns scripted responses.

**No module mocking anywhere. No test ever makes real HTTP.** If a test needs
`vi.mock`, the code under test has the wrong shape — fix the shape.

The Kit fake can reproduce the four findings the Kit design rests on, because a
fake that cannot lie the way Kit lies leaves the guards untested: a `201`
carrying a non-empty `warnings` array; a read that misses a cancelled subscriber
the way one without `status=all` does; a `404` on `PUT`; and a subscriber whose
`state` flips between the read and the write.

## 3. The worker seam — background work as a plain function

`drainQueue`, the day-30 Purge and the Feedback Digest each take their
dependencies as arguments and are called directly. Justified because each is
genuinely request-less: there is no HTTP request to hang them on, so forcing one
would be inventing a seam rather than using one.

Tests here assert on rows and on what the Kit fake received: cancelled → outcome
`suppressed`, never retried; `warnings` → permanent failure; no stored
`subscriber.id` → deferred; the percent-encoded address on the read; Purge takes
Feedback and every User including the Owner; the digest is never sent empty.

*Not yet built — the worker is a later ticket. Build it to this shape.*

## 4. The Seed Script seam — `seed(db, csvPath)`, with the CLI as a thin wrapper

The Seed Script is the one piece of the system with no user at all, so its
guarantees are asserted directly: it refuses a populated database; it produces
exactly 98 Tasks and 11 Phases from the **real committed CSV**, not a fixture;
a duplicate slug is a hard error; a blank link label is a hard error; the 68
dependency edges are validated for cycles and dangling targets; every row lands
with `published_at` set.

The numbers in the spec are measurements of that file, and this test is what
keeps them true.

*Not yet built — the Seed Script is a later ticket. Build it to this shape.*

## Seams deliberately not created

No component-level tests for the drawer, and no unit tests for the sort
comparator. The sort is observable at seam 1 by reading card order out of the
rendered Phase, and a component test of the drawer would assert structure rather
than behaviour. The two rendering behaviours worth pinning — Not Applicable
sinks and dims rather than vanishing, and `Varies by state` appears on the row —
are seam 1 assertions, and the first is load-bearing for ADR-0002.

## What is not covered by tests, and is covered instead

- **Kit's live behaviour.** Probed and recorded in the research files. The fake
  encodes what was observed; if Kit changes, the fake lies and the tests still
  pass. That is an accepted, named risk at this scale — a Kit failure degrades a
  newsletter sync, never the product.
- **Backup and restore.** Exercised by the monthly drill, which is a runbook,
  not a test.

## Prior art

**There is none, and none should be borrowed.** ADR-0005 cites the owner's
reference repo for stack and file conventions, and it is deliberately *not*
prior art for tests: it is a teaching repo with no multi-tenancy, no eager Task
Entries, no pinned pre-2.0 auth library and no injected outbound clients, so its
test style was shaped by none of the constraints that produced these four seams.
