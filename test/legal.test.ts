import { describe, expect, it, onTestFinished } from "vitest";

import { EMAIL_CONSENT_VERSION } from "~/consent/email-consent";
import { PRIVACY_LAST_UPDATED } from "~/routes/privacy";
import { TERMS_LAST_UPDATED } from "~/routes/terms";
import { createTestApp, signInAs, type TestApp } from "./harness";

/**
 * Seam 1, on the two documents a physician can read before they have an
 * account.
 *
 * Every assertion here is a sentence somebody can read on a page, because
 * that is the whole of what this ticket builds: there is no version column,
 * no acceptance row and no legal state machine. What can go wrong is the
 * wording — a promise the product does not keep, a disclosure that implies a
 * gate, or a sentence that forecloses a decision ADR-0006 deliberately left
 * open — so the wording is what is pinned.
 */

const PHYSICIAN = "dr.reed@example.com";

const EIN_DRAWER =
  "/tasks/foundation-planning?task=obtain-ein-employer-identification-number";

function newApp(): TestApp {
  const app = createTestApp();
  onTestFinished(() => app.close());
  return app;
}

async function readable(response: Response): Promise<string> {
  return (await response.text())
    .replaceAll("<!-- -->", "")
    .replaceAll("&#x27;", "'");
}

async function page(app: TestApp, path: string): Promise<string> {
  return readable(await app.fetch(path));
}

describe("what a physician can read before there is an account", () => {
  it("answers both addresses with no session at all", async () => {
    const app = newApp();

    expect((await app.fetch("/terms")).status).toBe(200);
    expect((await app.fetch("/privacy")).status).toBe(200);
    expect(app.cookies.size).toBe(0);
  });

  it("links to both from the sign-in screen, under the acceptance line", async () => {
    const app = newApp();

    const signIn = await page(app, "/sign-in");

    // Implicit acceptance, stated under the button. Registration does not
    // grow a second checkbox, so this sentence is the whole of it.
    expect(signIn).toContain("Signing in means you accept");
    expect(signIn).toContain('href="/terms"');
    expect(signIn).toContain('href="/privacy"');

    // And each document offers the way back, because the sign-in screen is
    // the only place a reader of either one came from.
    expect(await page(app, "/terms")).toContain('href="/sign-in"');
    expect(await page(app, "/privacy")).toContain('href="/sign-in"');
  });

  it("is a document rather than a promise to write one", async () => {
    const app = newApp();

    const terms = await page(app, "/terms");
    const privacy = await page(app, "/privacy");

    expect(terms).not.toMatch(/still being written|coming soon|placeholder/i);
    expect(privacy).not.toMatch(/still being written|coming soon|placeholder/i);
  });
});

describe("versioned by a date and by git, and by nothing else", () => {
  it("carries a date at the top of each document", async () => {
    const app = newApp();

    expect(await page(app, "/terms")).toContain(
      `Last updated ${TERMS_LAST_UPDATED}`,
    );
    expect(await page(app, "/privacy")).toContain(
      `Last updated ${PRIVACY_LAST_UPDATED}`,
    );
  });

  it("is not wired to the Consent Wording's version", async () => {
    const app = newApp();

    // `email_consent_version` names the sentence one person agreed to about
    // email. Moving it because the Terms were reworded would stop an old
    // consent record meaning what it meant, which is the one property it
    // exists for. Two version lines, deliberately independent.
    expect(await page(app, "/terms")).not.toContain(EMAIL_CONSENT_VERSION);
    expect(await page(app, "/privacy")).not.toContain(EMAIL_CONSENT_VERSION);
    expect(TERMS_LAST_UPDATED).not.toBe(EMAIL_CONSENT_VERSION);
    expect(PRIVACY_LAST_UPDATED).not.toBe(EMAIL_CONSENT_VERSION);
  });
});

describe("the Support View disclosure", () => {
  it("names the operator rather than hiding behind our staff", async () => {
    const app = newApp();

    const privacy = await page(app, "/privacy");

    // ADR-0001's own sentence, verbatim. It is the disclosure that makes
    // Support View honest, and it is the part of that decision that cannot
    // be un-told.
    expect(privacy).toContain(
      "Launch Tasks is run by one person. To help you when something goes wrong, that person can sign in to your practice and see it exactly as you do — including your Notes. Every time this happens it is recorded.",
    );
    expect(privacy).not.toMatch(/our staff|our team|user-generated content/i);
  });

  it("lands a second time, under the Note field", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const drawer = await page(app, EIN_DRAWER);

    // The policy is read once at registration; the Note box is where someone
    // is about to type the thing they would regret. Same sentence, narrowed
    // to the note being written.
    expect(drawer).toContain(
      "Launch Tasks is run by one person. To help you when something goes wrong, that person can sign in to your practice and see it exactly as you do — including this note.",
    );
  });

  it("implies no gate in either place", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const privacy = await page(app, "/privacy");
    const drawer = await page(app, EIN_DRAWER);

    // Support View is deliberately not consent-gated, so neither wording may
    // suggest it is something a physician grants, withholds or switches off.
    for (const surface of [privacy, drawer]) {
      expect(surface).not.toMatch(/\bconsent\b|\bpermission\b|\bapprove\b/i);
      expect(surface).not.toMatch(/only with your|if you allow|you can turn/i);
    }
  });

  it("never calls a Note private, on the page that would be believed", async () => {
    const app = newApp();

    // `Private Note` was dropped rather than left standing as a promise the
    // product no longer keeps (ADR-0001), and the policy is the last place
    // the adjective could survive.
    expect(await page(app, "/privacy")).not.toMatch(/private note/i);
  });
});

describe("purposes, not current practice (ADR-0006)", () => {
  it("describes measurement in the present tense, narrowly", async () => {
    const app = newApp();

    const privacy = await page(app, "/privacy");

    expect(privacy).toContain(
      "We look at how practices use the task list — for example, which tasks tend to stall — to improve the guidance we write. We do not sell your data, and we do not share it with advertisers.",
    );
  });

  it("forecloses nothing about later learning what stalls people", async () => {
    const app = newApp();

    const privacy = await page(app, "/privacy");

    // The sentence v1 could have written truthfully and would have had to
    // break: accurate on launch day, and a policy revision as the gate on
    // ever measuring anything.
    expect(privacy).not.toMatch(
      /do not currently|we (do not|never) (collect|measure|record|look at)/i,
    );
    expect(privacy).not.toMatch(/no analytics|we do not track/i);
  });

  it("refuses sale and advertising flatly, which is the one absolute", async () => {
    const app = newApp();

    const privacy = await page(app, "/privacy");

    expect(privacy).toContain("We do not sell your data");
    expect(privacy).toContain("we do not share it with advertisers");
  });
});

describe("subprocessors", () => {
  it("names Resend and Kit, because a physician has a real question", async () => {
    const app = newApp();

    const privacy = await page(app, "/privacy");

    expect(privacy).toContain("Resend");
    expect(privacy).toContain("Kit");
  });

  it("describes backup storage rather than naming it", async () => {
    const app = newApp();

    const privacy = await page(app, "/privacy");

    // Naming the places an encrypted blob sits buys nothing and turns a
    // vendor swap into a policy edit.
    expect(privacy).toContain(
      "Backups are encrypted and retained for a limited period, and are accessible only to the operator.",
    );
    expect(privacy).not.toMatch(
      /\bAWS\b|\bS3\b|Backblaze|Hetzner|DigitalOcean|Cloudflare|Dropbox/i,
    );

    // And the monitors, which receive no user data, are not subprocessors
    // and are not mentioned.
    expect(privacy).not.toMatch(/UptimeRobot|Healthchecks/i);
  });

  it("keeps Kit a separate relationship from the account", async () => {
    const app = newApp();

    const privacy = await page(app, "/privacy");

    // A Purge deliberately does not reach Kit: the newsletter was agreed to
    // separately and is left through the unsubscribe link.
    expect(privacy).toContain(
      "deleting your practice does not unsubscribe you",
    );
  });
});

describe("the Terms", () => {
  it("carry the guidance disclaimer, and requirements vary by state", async () => {
    const app = newApp();

    const terms = await page(app, "/terms");

    expect(terms).toContain(
      "Launch Tasks is a checklist, not professional advice. The tasks and their guidance are general information about starting a practice — not legal, tax, accounting, or medical-practice compliance advice. Requirements vary by state and change over time. Confirm anything that matters with your own attorney, accountant, or state medical board before acting on it.",
    );
  });

  it("carry the same thirty days the product tells an Owner", async () => {
    const app = newApp();
    await signInAs(app, PHYSICIAN);

    const confirmation = await page(app, "/settings?confirm=delete");

    // The confirmation an Owner reads and both documents carry one number,
    // so the Grace Period cannot drift between the product and the page
    // that promises it.
    expect(confirmation).toContain(
      "permanently deleted after thirty days",
    );
    expect(await page(app, "/terms")).toContain(
      "permanently deleted after thirty days",
    );
    expect(await page(app, "/privacy")).toContain("after thirty days");
  });
});
