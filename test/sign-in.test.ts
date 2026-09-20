import { sql } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";

import { session, user, verification } from "~/database/schema";
import { createTestApp, skipTailoringWizard, type TestApp } from "./harness";

/**
 * Seam 1, on the only door into the product.
 *
 * This file is also the evidence that Better Auth works on React Router v8 —
 * ADR-0004 recorded the integration as *expected to be a non-event, but
 * expectation, not evidence*. Every test below dispatches a real `Request` at
 * the real v8 request handler and reads a real `Response`, so a version bump
 * that breaks the pairing fails here rather than in an inbox.
 */

const PHYSICIAN = "dr.reed@example.com";

function newApp(): TestApp {
  const app = createTestApp();
  onTestFinished(() => app.close());
  return app;
}

/** Ask for a Sign-in Link the way the form does. */
async function requestLink(app: TestApp, email: string) {
  return app.fetch("/sign-in", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email }),
  });
}

/** The Sign-in Link out of the fake sender, as a physician would read it. */
function linkFrom(app: TestApp, email: string): string {
  const [link] = app.emailSender.linksTo(email);
  expect(link, "no Sign-in Link was mailed").toBeDefined();
  return link!;
}

async function pressContinue(app: TestApp, token: string, init?: RequestInit) {
  return app.fetch("/continue", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    ...init,
  });
}

function tokenFrom(link: string): string {
  return new URL(link).searchParams.get("token") ?? "";
}

/**
 * The page as a reader sees it. React splits interpolated text with `<!-- -->`
 * markers, which is rendering detail and never something a physician reads.
 */
async function readable(response: Response): Promise<string> {
  return (await response.text()).replaceAll("<!-- -->", "");
}

describe("signing in with a Sign-in Link", () => {
  // ADR-0004's first mandatory test: request, email, verify, session.
  it("takes a physician from an email address to a session", async () => {
    const app = newApp();

    const requested = await requestLink(app, PHYSICIAN);
    expect(requested.status).toBe(302);
    expect(requested.headers.get("Location")).toBe("/check-your-email");

    const link = linkFrom(app, PHYSICIAN);
    expect(new URL(link).pathname).toBe("/continue");

    const screen = await app.fetch(link);
    expect(screen.status).toBe(200);
    expect(await screen.text()).toContain("Continue");

    const continued = await pressContinue(app, tokenFrom(link));
    expect(continued.status).toBe(302);
    expect(continued.headers.get("Location")).toBe("/tasks");

    // The Tailoring Wizard now stands between a new Owner and the list, and
    // pressing its Skip is the only thing this test wants from it.
    await skipTailoringWizard(app);

    // The session is real, and the proof is the list opening: the journey map
    // is behind the door, and a visitor without a session is sent back out.
    const map = await app.fetch("/tasks/foundation-planning");
    expect(map.status).toBe(200);
    expect(await readable(map)).toContain("Obtain EIN");

    expect(app.database.select().from(user).all()).toHaveLength(1);
    expect(app.database.select().from(session).all()).toHaveLength(1);
  });

  it("mails the link from DirectCareTools, with a reply address a human reads", async () => {
    const app = newApp();
    await requestLink(app, PHYSICIAN);

    const message = app.emailSender.lastTo(PHYSICIAN);
    expect(message?.from).toBe(
      "DirectCareTools <noreply@mail.directcaretools.com>",
    );
    expect(message?.replyTo).toBe("admin@directcaretools.com");
    expect(message?.text).toContain("works once");
  });

  it("never stores a working link: what is kept is a hash of the token", async () => {
    const app = newApp();
    await requestLink(app, PHYSICIAN);

    const token = tokenFrom(linkFrom(app, PHYSICIAN));
    const rows = app.database.select().from(verification).all();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.identifier).not.toBe(token);
  });
});

describe("the Continue Screen", () => {
  it("does nothing at all when it is merely opened", async () => {
    const app = newApp();
    await requestLink(app, PHYSICIAN);
    const link = linkFrom(app, PHYSICIAN);

    const opened = await app.fetch(link);

    expect(opened.status).toBe(200);
    expect(opened.headers.getSetCookie()).toHaveLength(0);
    expect(app.cookies.size).toBe(0);
    // The one row that would be gone if the fetch had spent the link.
    expect(app.database.select().from(verification).all()).toHaveLength(1);
    expect(app.database.select().from(user).all()).toHaveLength(0);

    // And the link still works afterwards, which is the whole point of the
    // screen: a mail scanner fetching it first must not cost the physician
    // their login.
    const continued = await pressContinue(app, tokenFrom(link));
    expect(continued.headers.get("Location")).toBe("/tasks");
  });

  it("looks identical for a good link, an expired one and a forged one", async () => {
    const app = newApp();
    await requestLink(app, PHYSICIAN);
    const good = linkFrom(app, PHYSICIAN);

    const forged = new URL(good);
    forged.searchParams.set("token", "a".repeat(32));

    // "Expired" is indistinguishable by construction: the `GET` does not
    // validate, so a token whose row is long gone renders the same page as one
    // that was never issued.
    const expired = new URL(good);
    expired.searchParams.set("token", "b".repeat(32));

    const pages = await Promise.all(
      [good, forged.toString(), expired.toString()].map(async (url) => {
        const response = await app.fetch(url);
        // The page echoes back the token the visitor arrived with — they
        // already have it. Everything else about the page must match.
        const token = new URL(url).searchParams.get("token") ?? "";
        return (await response.text()).replaceAll(token, "TOKEN");
      }),
    );

    expect(pages[1]).toBe(pages[0]);
    expect(pages[2]).toBe(pages[0]);
  });

  it("refuses a Continue posted from another origin", async () => {
    const app = newApp();
    await requestLink(app, PHYSICIAN);
    const token = tokenFrom(linkFrom(app, PHYSICIAN));

    const response = await pressContinue(app, token, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://not-us.example.com",
      },
    });

    // React Router v8 refuses a mismatched `Origin` before any action runs, so
    // this one is the framework's 400 rather than our 403. Our own check is
    // what covers the case it does not — see the test below.
    expect(response.status).toBe(400);
    expect(app.database.select().from(session).all()).toHaveLength(0);
  });

  it("refuses a Continue that arrives with no origin at all", async () => {
    const app = newApp();
    await requestLink(app, PHYSICIAN);
    const token = tokenFrom(linkFrom(app, PHYSICIAN));

    // A browser always sends `Origin` on a cross-origin form post, so its
    // absence is as disqualifying as a wrong value. React Router lets this
    // through; the check that stops it is ours, which is the one the router
    // never mounting `auth.handler` cost us (ADR-0004).
    const response = await app.fetch(
      new Request("http://localhost:3000/continue", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      }),
    );

    expect(response.status).toBe(403);
    expect(app.database.select().from(session).all()).toHaveLength(0);
  });

  it("spends the link, so pressing Continue twice does not sign in twice", async () => {
    const app = newApp();
    await requestLink(app, PHYSICIAN);
    const token = tokenFrom(linkFrom(app, PHYSICIAN));

    await pressContinue(app, token);
    app.clearCookies();

    const again = await pressContinue(app, token);
    expect(again.headers.get("Location")).toBe("/sign-in?link=failed");
    expect(app.database.select().from(session).all()).toHaveLength(1);
  });
});

describe("a Sign-in Link that fails", () => {
  it("stops working after ten minutes", async () => {
    const app = newApp();
    await requestLink(app, PHYSICIAN);
    const token = tokenFrom(linkFrom(app, PHYSICIAN));

    // Ten minutes is tolerance for email latency and nothing else, so the
    // thing worth pinning is that it really is ten and not the library's
    // five-minute default. At nine the link still works; past ten it does not.
    ageSignInLinks(app, 9 * 60);
    const stillGood = await app.fetch("/continue", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    expect(stillGood.headers.get("Location")).toBe("/tasks");

    const app2 = newApp();
    await requestLink(app2, PHYSICIAN);
    const staleToken = tokenFrom(linkFrom(app2, PHYSICIAN));
    ageSignInLinks(app2, 11 * 60);

    const expired = await pressContinue(app2, staleToken);
    expect(expired.headers.get("Location")).toBe("/sign-in?link=failed");
    expect(app2.database.select().from(session).all()).toHaveLength(0);
  });

  it("lands on the sign-in page, names no cause, and reissues nothing", async () => {
    const app = newApp();

    const refused = await pressContinue(app, "not-a-real-token");
    expect(refused.headers.get("Location")).toBe("/sign-in?link=failed");

    const page = await app.fetch("/sign-in?link=failed");
    const text = await readable(page);

    expect(text).toContain("last ten minutes");
    expect(text).toContain("work once");
    for (const guess of ["already used", "expired", "invalid", "not found"]) {
      expect(text.toLowerCase()).not.toContain(guess);
    }

    // No auto-reissue: a failed token says nothing about the address, so there
    // is nobody to send a new link to.
    expect(app.emailSender.sent).toHaveLength(0);
  });
});

describe("the answer to the sign-in form", () => {
  it("is byte-identical for an unknown address, a known one and one over its limit", async () => {
    const app = newApp();

    // Make one address known, all the way through to a session.
    await requestLink(app, PHYSICIAN);
    await pressContinue(app, tokenFrom(linkFrom(app, PHYSICIAN)));
    app.clearCookies();

    const known = await requestLink(app, PHYSICIAN);
    const unknown = await requestLink(app, "nobody@example.com");

    // Over the per-address limit: the fourth request in fifteen minutes.
    await requestLink(app, PHYSICIAN);
    await requestLink(app, PHYSICIAN);
    const overLimit = await requestLink(app, PHYSICIAN);

    // The whole response, not just the status: a header or a body that
    // differed would be the leak, and comparing only what we expected to
    // differ would be assuming the answer.
    const answers = await Promise.all(
      [known, unknown, overLimit].map(describe_),
    );

    expect(answers[0]).toContain("302 /check-your-email");
    expect(answers[1]).toBe(answers[0]);
    expect(answers[2]).toBe(answers[0]);
  });
});

describe("the per-address limit on the send leg", () => {
  it("stops at three in fifteen minutes, silently", async () => {
    const app = newApp();

    for (let attempt = 0; attempt < 3; attempt++) {
      await requestLink(app, PHYSICIAN);
    }
    expect(app.emailSender.sent).toHaveLength(3);

    const fourth = await requestLink(app, PHYSICIAN);

    expect(fourth.headers.get("Location")).toBe("/check-your-email");
    expect(app.emailSender.sent).toHaveLength(3);
  });

  it("stops at ten in a rolling day, silently", async () => {
    const app = newApp();

    // Three at a time, then push them into the past so the fifteen-minute
    // window clears while the rolling day does not. Ageing the rows is the
    // only way to let a day pass inside a test; nothing else here reaches into
    // the app's own tables.
    for (let round = 0; round < 3; round++) {
      for (let attempt = 0; attempt < 3; attempt++) {
        await requestLink(app, PHYSICIAN);
      }
      ageSignInLinkRequests(app, 20 * 60);
    }
    expect(app.emailSender.sent).toHaveLength(9);

    await requestLink(app, PHYSICIAN);
    expect(app.emailSender.sent).toHaveLength(10);

    const eleventh = await requestLink(app, PHYSICIAN);
    expect(eleventh.headers.get("Location")).toBe("/check-your-email");
    expect(app.emailSender.sent).toHaveLength(10);
  });

  it("counts an address regardless of how it was typed", async () => {
    const app = newApp();

    await requestLink(app, PHYSICIAN);
    await requestLink(app, PHYSICIAN.toUpperCase());
    await requestLink(app, ` ${PHYSICIAN} `);
    await requestLink(app, PHYSICIAN);

    expect(app.emailSender.sent).toHaveLength(3);
  });
});

describe("the per-IP limit on the verify leg", () => {
  it("stops at twenty in ten minutes, and says so", async () => {
    const app = newApp();

    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await pressContinue(app, `token-${attempt}`);
      expect(response.status).toBe(302);
    }

    const refused = await pressContinue(app, "token-21");
    expect(refused.status).toBe(429);
    expect(await refused.text()).toContain("Too many attempts");
  });
});

describe("the session", () => {
  // ADR-0004: `session.cookieCache` must never be enabled. With it on,
  // `getSession` is served from a signed cookie with no database read, and a
  // session that has been revoked stays alive for the cache's `maxAge` —
  // which would make an Owner removing a Member a change that does not take
  // effect. Better Auth's own documentation claims a paragraph above its own
  // warning that revocation invalidates the cookie automatically; that
  // sentence is false as of 1.7.5, and this test is what would fail if a
  // future reader believed it.
  it("is read from the database on every request, never from the cookie", async () => {
    const app = newApp();
    await requestLink(app, PHYSICIAN);
    await pressContinue(app, tokenFrom(linkFrom(app, PHYSICIAN)));

    // A signed-in physician is sent to their list; a signed-out one is not.
    expect((await app.fetch("/")).headers.get("Location")).toBe("/tasks");

    app.database.delete(session).run();

    // The cookie is untouched and still in the jar; only the row is gone.
    expect(app.cookies.size).toBeGreaterThan(0);
    expect((await app.fetch("/")).headers.get("Location")).toBeNull();
    expect(
      (await app.fetch("/tasks/foundation-planning")).headers.get("Location"),
    ).toBe("/sign-in");
  });
});

describe("what a physician can read before they have an account", () => {
  it("states implicit acceptance under the button, and links to both pages", async () => {
    const app = newApp();
    const text = await readable(await app.fetch("/sign-in"));

    expect(text).toContain("Signing in means you accept");
    expect(text).toContain('href="/terms"');
    expect(text).toContain('href="/privacy"');

    expect((await app.fetch("/terms")).status).toBe(200);
    expect((await app.fetch("/privacy")).status).toBe(200);
  });

  it("asks the browser for nothing but a form submission", async () => {
    const app = newApp();
    await requestLink(app, PHYSICIAN);

    const signIn = await readable(await app.fetch("/sign-in"));
    const continueScreen = await readable(
      await app.fetch(linkFrom(app, PHYSICIAN)),
    );

    // Every test in this file is the evidence for the claim itself: nothing
    // here runs a browser, and the whole flow works anyway. What this one
    // pins is the reason that is possible — both screens are a real `<form>`
    // posting to a real URL, so nothing on the login path is waiting for
    // `<Scripts />` to arrive and hydrate it.
    for (const page of [signIn, continueScreen]) {
      expect(page).toMatch(/<form[^>]*action="\/[^"]*"[^>]*method="post"/);
    }
  });
});

/**
 * A response reduced to everything a caller could read off it: status,
 * every header, and the body.
 */
async function describe_(response: Response): Promise<string> {
  const headers = [...response.headers]
    .map(([name, value]) => `${name}: ${value}`)
    .sort()
    .join("\n");

  return `${response.status} ${response.headers.get("Location") ?? ""}\n${headers}\n${await response.text()}`;
}

/** Push every recorded Sign-in Link request `seconds` further into the past. */
function ageSignInLinkRequests(app: TestApp, seconds: number) {
  app.database.run(
    sql`update sign_in_link_request set requested_at = requested_at - ${seconds}`,
  );
}

/** Push every unspent Sign-in Link `seconds` closer to its expiry. */
function ageSignInLinks(app: TestApp, seconds: number) {
  app.database.run(
    sql`update verification set expires_at = expires_at - ${seconds}`,
  );
}
