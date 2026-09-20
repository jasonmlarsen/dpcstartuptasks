import { eq } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";

import { drainQueue } from "~/consent/kit-sync-worker";
import { kitSyncJob, user } from "~/database/schema";
import {
  KIT_PRACTICE_STATE_FIELD_KEY,
  KIT_SIGNUP_TAG_ID,
} from "~/services/kit-client";
import { subscriberSearchPath } from "~/services/kit-http-client";
import { createTestApp, signInAs, type TestApp } from "./harness";

/**
 * Kit Sync Jobs: seam 1 for the consent that enqueues them, seam 3 for the
 * worker that drains them.
 *
 * The division is the one the Feedback Digest set. Every test here *arranges*
 * through the request seam — a physician registers, or presses Subscribe, or
 * saves a state on the settings page — and then calls `drainQueue` directly,
 * because there is no request to hang a worker on. Nothing below writes a job
 * row by hand: a queue full of rows no screen produced would pass happily
 * while the screens that are supposed to fill it did nothing.
 *
 * The guards under test are the four findings the Kit design rests on, and
 * each one exists because Kit does something a reasonable reading of its
 * status codes would miss. The fake can lie in all four ways, which is the
 * whole reason it exists.
 */

const PHYSICIAN = "dr.reed@example.com";
const SPOUSE = "jamie.reed@example.com";

function newApp(): TestApp {
  const app = createTestApp();
  onTestFinished(() => app.close());
  return app;
}

function post(body: Record<string, string>): RequestInit {
  return {
    method: "post",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  };
}

/** The page as a reader sees it, without React's interpolation markers. */
async function readable(response: Response): Promise<string> {
  return (await response.text()).replaceAll("<!-- -->", "");
}

function jobs(app: TestApp) {
  return app.database.select().from(kitSyncJob).all();
}

function userRow(app: TestApp, email: string) {
  return app.database.select().from(user).where(eq(user.email, email)).get();
}

describe("the queue, and what a request may do about Kit", () => {
  it("enqueues a signup job at registration and calls Kit from no request", async () => {
    const app = newApp();

    await signInAs(app, PHYSICIAN, { emailConsent: true });

    expect(jobs(app)).toMatchObject([{ kind: "signup", outcome: null }]);
    // The load-bearing assertion of the whole ticket: a physician registered,
    // got their Practice and their list, and Kit was never spoken to. A Kit
    // outage cannot delay or fail any of that, because nothing waited on it.
    expect(app.kitClient.calls).toEqual([]);
  });

  it("enqueues nothing for a physician who declined", async () => {
    const app = newApp();

    await signInAs(app, PHYSICIAN, { emailConsent: false });

    expect(jobs(app)).toEqual([]);
  });

  it("does not stack a second job on top of one still waiting", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN, { emailConsent: false });

    await app.fetch("/settings", post({ intent: "subscribe" }));
    await app.fetch("/settings", post({ intent: "subscribe" }));

    expect(jobs(app)).toHaveLength(1);
  });

  it("enqueues a practice_state job when the Practice moves state", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN, { emailConsent: true });
    await drainQueue(app.database, app.kitClient);

    await app.fetch(
      "/settings",
      post({
        intent: "practice",
        practiceName: "Reed Direct Care",
        state: "Ohio",
        displayName: "Dr Alex Reed",
      }),
    );

    expect(jobs(app).filter((job) => job.kind === "practice_state")).toHaveLength(1);
  });

  it("enqueues no practice_state job for a Member who never consented", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN, { emailConsent: false });
    await app.fetch(
      "/settings",
      post({
        intent: "practice",
        practiceName: "Reed Direct Care",
        state: "Ohio",
        displayName: "Dr Alex Reed",
      }),
    );

    // Nobody in this Practice is on Kit's list, so there is no fact to tell
    // Kit and no job to suppress later.
    expect(jobs(app)).toEqual([]);
  });
});

describe("the worker, on the happy path", () => {
  it("creates the subscriber, tags it, and remembers the id", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN, { emailConsent: true });

    const drained = await drainQueue(app.database, app.kitClient);

    expect(drained).toMatchObject({ picked: 1, synced: 1 });
    expect(app.kitClient.callsTo("createSubscriber")).toMatchObject([
      { input: { email_address: PHYSICIAN } },
    ]);
    expect(app.kitClient.callsTo("addSubscriberToTag")).toMatchObject([
      { tagId: KIT_SIGNUP_TAG_ID },
    ]);
    expect(userRow(app, PHYSICIAN)?.kitSubscriberId).toBeGreaterThan(0);
    expect(jobs(app)[0]).toMatchObject({ outcome: "synced", attempts: 1 });
  });

  it("reads before it writes, by address when no id is stored", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN, { emailConsent: true });

    await drainQueue(app.database, app.kitClient);

    expect(app.kitClient.calls[0]).toEqual({
      method: "findSubscriberByEmail",
      email: PHYSICIAN,
    });
  });

  it("reads by id once one has been stored, and updates rather than creates", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN, { emailConsent: true });
    await drainQueue(app.database, app.kitClient);
    const subscriberId = userRow(app, PHYSICIAN)!.kitSubscriberId;

    // A second Subscribe press, which is a second job over the same address.
    await app.fetch("/settings", post({ intent: "subscribe" }));
    await drainQueue(app.database, app.kitClient);

    expect(app.kitClient.callsTo("findSubscriberById")).toMatchObject([
      { id: subscriberId },
    ]);
    expect(app.kitClient.callsTo("createSubscriber")).toHaveLength(1);
    expect(app.kitClient.callsTo("updateSubscriber")).toMatchObject([
      { id: subscriberId },
    ]);
  });

  it("writes the Practice State to practice_state and never to state", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN, { emailConsent: true, tailoring: "owed" });
    await app.fetch(
      "/welcome",
      post({ state: "Ohio", fixedLocation: "yes", expectsEmployees: "no" }),
    );

    await drainQueue(app.database, app.kitClient);

    const written = app.kitClient.callsTo("createSubscriber")[0]!.input.fields;
    expect(written).toEqual({ [KIT_PRACTICE_STATE_FIELD_KEY]: "Ohio" });
    expect(written).not.toHaveProperty("state");
  });

  it("carries a later state change to Kit as its own job", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN, { emailConsent: true });
    await drainQueue(app.database, app.kitClient);

    await app.fetch(
      "/settings",
      post({
        intent: "practice",
        practiceName: "Reed Direct Care",
        state: "Idaho",
        displayName: "Dr Alex Reed",
      }),
    );
    const drained = await drainQueue(app.database, app.kitClient);

    expect(drained).toMatchObject({ synced: 1 });
    expect(app.kitClient.callsTo("updateSubscriber").at(-1)?.input.fields).toEqual({
      [KIT_PRACTICE_STATE_FIELD_KEY]: "Idaho",
    });
  });
});

describe("Cancelled, which is a hard wall", () => {
  /** A physician whose address Kit already holds as Cancelled. */
  async function withCancelledAddress(): Promise<TestApp> {
    const app = newApp();
    app.kitClient.givenSubscriber({
      email_address: PHYSICIAN,
      state: "cancelled",
      fields: {},
    });
    await signInAs(app, PHYSICIAN, { emailConsent: true });
    return app;
  }

  it("writes nothing at all — no subscriber, no tag, no field", async () => {
    const app = await withCancelledAddress();

    await drainQueue(app.database, app.kitClient);

    expect(app.kitClient.callsTo("createSubscriber")).toEqual([]);
    expect(app.kitClient.callsTo("updateSubscriber")).toEqual([]);
    expect(app.kitClient.callsTo("addSubscriberToTag")).toEqual([]);
  });

  it("succeeds as suppressed, and is never retried", async () => {
    const app = await withCancelledAddress();

    const drained = await drainQueue(app.database, app.kitClient);
    const again = await drainQueue(app.database, app.kitClient);

    expect(drained).toMatchObject({ suppressed: 1, failed: 0, deferred: 0 });
    expect(jobs(app)[0]).toMatchObject({ outcome: "suppressed" });
    // Settled is settled: a dead-lettered or requeued job would be the queue
    // arguing with a physician who unsubscribed.
    expect(again.picked).toBe(0);
  });

  it("records the refusal locally, so settings can explain it without Kit", async () => {
    const app = await withCancelledAddress();

    await drainQueue(app.database, app.kitClient);

    expect(userRow(app, PHYSICIAN)?.kitSuppressedAt).toBeInstanceOf(Date);
    // Consent is append-only and untouched: the physician did say yes, once,
    // and Kit saying they have since left is a different fact.
    expect(userRow(app, PHYSICIAN)?.emailConsentGrantedAt).not.toBeNull();
  });

  it("collapses never-consented into the same rule: nothing is written", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN, { emailConsent: true });
    // The one way to reach a job for somebody with no consent in hand, short
    // of writing a row by hand: the act is what the worker re-reads, not what
    // the enqueuing screen believed.
    app.database
      .update(user)
      .set({ emailConsentGrantedAt: null })
      .where(eq(user.email, PHYSICIAN))
      .run();

    const drained = await drainQueue(app.database, app.kitClient);

    expect(drained).toMatchObject({ suppressed: 1 });
    expect(app.kitClient.calls).toEqual([]);
  });

  it("stops the read/write race on the write's own response", async () => {
    const app = newApp();
    const subscriber = app.kitClient.givenSubscriber({
      email_address: PHYSICIAN,
      state: "active",
      fields: {},
    });
    await signInAs(app, PHYSICIAN, { emailConsent: true });

    // Kit's own behaviour: it does not defend a subscriber who cancels
    // between our read and our write. It takes the write and answers 200.
    app.kitClient.onBeforeWrite = (fake) => {
      fake.subscribers.set(subscriber.id, { ...subscriber, state: "cancelled" });
    };

    const drained = await drainQueue(app.database, app.kitClient);

    expect(drained).toMatchObject({ suppressed: 1 });
    expect(userRow(app, PHYSICIAN)?.kitSuppressedAt).toBeInstanceOf(Date);
    // The wall went back up before the tag, which is the part of the write
    // that would have put a cancelled address on a mailing list.
    expect(app.kitClient.callsTo("addSubscriberToTag")).toEqual([]);
  });

  it("clears a stale suppression once Kit reports the address active again", async () => {
    const app = await withCancelledAddress();
    await drainQueue(app.database, app.kitClient);

    // The physician goes through the Resubscribe Form, which the app links to
    // and never operates: they come back active, keeping their subscriber id.
    const [cancelled] = [...app.kitClient.subscribers.values()];
    app.kitClient.subscribers.set(cancelled!.id, {
      ...cancelled!,
      state: "active",
    });

    await app.fetch("/settings", post({ intent: "subscribe" }));
    await drainQueue(app.database, app.kitClient);

    expect(userRow(app, PHYSICIAN)?.kitSuppressedAt).toBeNull();
  });
});

describe("what a 2xx does not mean", () => {
  it("treats a non-empty warnings array on a 201 as a permanent failure", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN, { emailConsent: true });

    // Observed live: Kit answers a bogus field key with 201, creates the
    // subscriber, and silently drops the key. The status code is a lie.
    app.kitClient.scriptNext("createSubscriber", {
      ok: true,
      status: 201,
      data: {
        id: 7,
        email_address: PHYSICIAN,
        state: "active",
        fields: {},
      },
      warnings: ["Unrecognized field: practice_state"],
    });

    const drained = await drainQueue(app.database, app.kitClient);
    const again = await drainQueue(app.database, app.kitClient);

    expect(drained).toMatchObject({ failed: 1, synced: 0 });
    expect(jobs(app)[0]?.detail).toContain("practice_state");
    // Permanent: a dead letter is not retried, because the field it needs
    // does not exist and no number of attempts will create it.
    expect(again.picked).toBe(0);
    expect(app.kitClient.callsTo("addSubscriberToTag")).toEqual([]);
  });
});

describe("deferral, which is not failure", () => {
  it("reschedules a 404 on the update rather than dead-lettering it", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN, { emailConsent: true });
    await drainQueue(app.database, app.kitClient);
    const subscriberId = userRow(app, PHYSICIAN)!.kitSubscriberId;

    // The subscriber is deleted in Kit's dashboard; our stored id now names
    // nobody. A read finds them anyway — the fake answers from its map — and
    // the write is where Kit says no.
    await app.fetch("/settings", post({ intent: "subscribe" }));
    app.kitClient.scriptNext("updateSubscriber", { ok: false, status: 404, warnings: [] });

    const now = new Date();
    const drained = await drainQueue(app.database, app.kitClient, now);

    expect(drained).toMatchObject({ deferred: 1, failed: 0 });
    const job = jobs(app).at(-1)!;
    expect(job.outcome).toBeNull();
    expect(job.runAfter.getTime()).toBeGreaterThan(now.getTime());
    // And the stale id is forgotten, so the next run goes looking by address
    // instead of 404ing forever against an id Kit threw away.
    expect(userRow(app, PHYSICIAN)?.kitSubscriberId).toBeNull();
    expect(subscriberId).toBeGreaterThan(0);
  });

  it("defers a practice_state job until the first sync has landed", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN, { emailConsent: true, tailoring: "owed" });
    await app.fetch(
      "/welcome",
      post({ state: "Ohio", fixedLocation: "yes", expectsEmployees: "no" }),
    );

    // Kit is down for the signup job, so no id is ever stored — which is the
    // only way the state job behind it can meet the case it has to defer on.
    // It must not go looking by address, and must never create.
    app.kitClient.scriptNext("findSubscriberByEmail", {
      ok: false,
      status: 503,
      warnings: [],
    });
    const drained = await drainQueue(app.database, app.kitClient);

    expect(drained).toMatchObject({ deferred: 2, failed: 0, synced: 0 });
    expect(app.kitClient.callsTo("createSubscriber")).toEqual([]);
    expect(jobs(app).find((job) => job.kind === "practice_state")).toMatchObject({
      outcome: null,
      detail: "the first sync has not landed yet",
    });
  });

  it("runs a deferred job again once its turn comes", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN, { emailConsent: true });
    app.kitClient.scriptNext("findSubscriberByEmail", {
      ok: false,
      status: 503,
      warnings: [],
    });

    const outage = new Date();
    await drainQueue(app.database, app.kitClient, outage);
    const later = new Date(outage.getTime() + 60 * 60 * 1000);
    const drained = await drainQueue(app.database, app.kitClient, later);

    expect(drained).toMatchObject({ picked: 1, synced: 1 });
    expect(jobs(app)[0]).toMatchObject({ outcome: "synced", attempts: 2 });
  });
});

describe("the read that has to be able to see a cancelled subscriber", () => {
  /**
   * Not a test of our code but of the URL our code builds, and it is here
   * because the parameter is the guard. Kit's default search returns
   * `{"subscribers": []}` for a cancelled address, so a worker reading
   * without `status=all` sees *absent*, and absent means *create*.
   */
  it("asks with status=all and percent-encodes the address", () => {
    const path = subscriberSearchPath("dr.reed+dpc@example.com");

    expect(path).toContain("status=all");
    expect(path).toContain("dr.reed%2Bdpc%40example.com");
  });

  it("falls back to the address when a stored id names nobody", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN, { emailConsent: true });
    await drainQueue(app.database, app.kitClient);

    // The subscriber is deleted in Kit's dashboard and signs up again through
    // some other door, then cancels: the address is Cancelled under an id we
    // have never seen, and the id we hold names nobody.
    app.kitClient.subscribers.clear();
    app.kitClient.givenSubscriber({
      email_address: PHYSICIAN,
      state: "cancelled",
      fields: {},
    });

    await app.fetch("/settings", post({ intent: "subscribe" }));
    const drained = await drainQueue(app.database, app.kitClient);

    // Believing the empty read by id would have created a subscriber for an
    // address sitting there Cancelled — straight through the wall.
    expect(app.kitClient.callsTo("findSubscriberByEmail")).toHaveLength(2);
    expect(drained).toMatchObject({ suppressed: 1 });
    expect(app.kitClient.callsTo("createSubscriber")).toHaveLength(1);
  });

  it("shows what a read that cannot see a cancelled subscriber costs", async () => {
    const app = newApp();
    app.kitClient.givenSubscriber({
      email_address: PHYSICIAN,
      state: "cancelled",
      fields: {},
    });
    await signInAs(app, PHYSICIAN, { emailConsent: true });

    // The lie a missing `status=all` tells, scripted explicitly: the
    // subscriber is right there and the read answers with nobody.
    app.kitClient.scriptNext("findSubscriberByEmail", {
      ok: true,
      status: 200,
      data: null,
      warnings: [],
    });
    await drainQueue(app.database, app.kitClient);

    // The worker walks straight through the wall, because the wall is built
    // out of what the read said. Nothing downstream can recover this, which
    // is why the parameter is on the URL and not a caller's option.
    expect(app.kitClient.callsTo("createSubscriber")).toHaveLength(1);
  });
});

describe("the settings page, when Kit has said Cancelled", () => {
  async function suppressed(): Promise<TestApp> {
    const app = newApp();
    app.kitClient.givenSubscriber({
      email_address: PHYSICIAN,
      state: "cancelled",
      fields: {},
    });
    await signInAs(app, PHYSICIAN, { emailConsent: false });
    await app.fetch("/settings", post({ intent: "subscribe" }));
    await drainQueue(app.database, app.kitClient);
    return app;
  }

  it("removes the Subscribe button entirely and links to the Resubscribe Form", async () => {
    const app = await suppressed();

    const page = await readable(await app.fetch("/settings"));

    expect(page).not.toContain('value="subscribe"');
    expect(page).toContain("https://directcaretools.kit.com/resubscribe");
    expect(page).toContain("cannot add you back ourselves");
  });

  it("shows the button to anyone Kit has not refused", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN, { emailConsent: false });

    const page = await readable(await app.fetch("/settings"));

    expect(page).toContain('value="subscribe"');
    expect(page).not.toContain("https://directcaretools.kit.com/resubscribe");
  });

  it("grants consent and enqueues a job when the button is pressed", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN, { emailConsent: false });

    await app.fetch("/settings", post({ intent: "subscribe" }));

    expect(userRow(app, PHYSICIAN)?.emailConsentGrantedAt).toBeInstanceOf(Date);
    expect(jobs(app)).toMatchObject([{ kind: "signup", outcome: null }]);
    // Still nothing over the wire from a request.
    expect(app.kitClient.calls).toEqual([]);
  });
});

describe("the card at the end of the Tailoring Wizard", () => {
  it("offers email to a physician who declined at registration", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN, { emailConsent: false, tailoring: "owed" });

    const page = await readable(await app.fetch("/welcome"));

    expect(page).toContain("One more thing");
    expect(page).toContain('value="subscribe"');
  });

  it("is absent for a physician who already said yes", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN, { emailConsent: true, tailoring: "owed" });

    const page = await readable(await app.fetch("/welcome"));

    expect(page).not.toContain("One more thing");
  });

  it("is dismissible, and dismissing it asks nothing else", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN, { emailConsent: false, tailoring: "owed" });

    const page = await readable(await app.fetch("/welcome?email=no"));

    expect(page).not.toContain("One more thing");
    // The Wizard itself is untouched: dismissing the card is not an answer
    // to the three questions.
    expect(page).toContain("Three questions before we start");
    expect(jobs(app)).toEqual([]);
  });

  it("grants consent and enqueues a job without answering the Wizard", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN, { emailConsent: false, tailoring: "owed" });

    const response = await app.fetch("/welcome", post({ intent: "subscribe" }));

    expect(response.headers.get("Location")).toBe("/welcome?email=thanks");
    expect(userRow(app, PHYSICIAN)?.emailConsentGrantedAt).toBeInstanceOf(Date);
    expect(jobs(app)).toMatchObject([{ kind: "signup" }]);
    // The Wizard is still owed: saying yes to email did not answer three
    // questions about a practice.
    expect((await app.fetch("/welcome")).status).toBe(200);
  });

  it("puts nothing on the task list screen", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN, { emailConsent: false });

    const page = await readable(await app.fetch("/tasks"));

    expect(page).not.toContain("One more thing");
    expect(page).not.toContain('value="subscribe"');
  });
});

describe("a second person in the Practice", () => {
  it("gets a state job of their own, because Kit holds the field per person", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN, { emailConsent: true });
    await app.fetch(
      "/settings",
      post({
        intent: "invite",
        email: SPOUSE,
        yourName: "Dr Alex Reed",
        practiceName: "Reed Direct Care",
      }),
    );
    await signInAs(app, SPOUSE, { emailConsent: true });
    await drainQueue(app.database, app.kitClient);

    await app.fetch(
      "/settings",
      post({
        intent: "practice",
        practiceName: "Reed Direct Care",
        state: "Ohio",
        displayName: "Jamie Reed",
      }),
    );

    expect(jobs(app).filter((job) => job.kind === "practice_state")).toHaveLength(2);
  });
});
