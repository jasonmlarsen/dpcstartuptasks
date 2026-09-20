import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq, isNotNull } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";
import * as serverBuild from "virtual:react-router/server-build";

import {
  invite,
  membership,
  practice,
  taskEntry,
  user,
} from "~/database/schema";
import {
  buildDummyPractices,
  DummyPracticeError,
  MOST_PRACTICES_PER_RUN,
  type DummySite,
} from "~/dev/dummy-practices";
import { NotDevelopmentError, assertDevelopment, productionSigns } from "~/dev/not-production";
import { runDummyPractices } from "~/dev/run-dummy-practices";
import { createTestApp, type TestApp } from "./harness";

/**
 * Seam 1, on the dev tool that builds dummy Practices.
 *
 * The tool exists to be a free smoke test: every development pass that wants
 * an account re-exercises signup, the invite and acceptance flow, the
 * three-person cap and the Tailoring Wizard, because those are the only
 * paths it has. So this file asserts the thing that claim rests on — the
 * rows it leaves behind are rows **only the real screens can write**: a
 * Membership per person, a Task Entry per Task, an Invite marked accepted,
 * and a Practice Profile the Wizard put there.
 *
 * It drives the builder through the harness rather than through the CLI,
 * because the CLI is a wrapper around a Vite server and a SQLite path and
 * has no behaviour of its own. `productionSigns` is the one thing asserted
 * directly: it is a pure function over an environment, asks the product to
 * do nothing, and is the guard the whole tool rests on.
 */

function newApp(): TestApp {
  const app = createTestApp();
  onTestFinished(() => app.close());
  return app;
}

/** The harness, in the shape the builder drives: a browser and a mailbox. */
function siteOf(app: TestApp): DummySite {
  return {
    fetch: (input, init) => app.fetch(input, init),
    clearCookies: () => app.clearCookies(),
    linksTo: (email) => app.emailSender.linksTo(email),
  };
}

function membershipsOf(app: TestApp, email: string) {
  return app.database
    .select({ practiceId: membership.practiceId, role: membership.role })
    .from(membership)
    .innerJoin(user, eq(membership.userId, user.id))
    .where(eq(user.email, email))
    .all();
}

describe("the dev tool that builds dummy Practices", () => {
  it("builds a Practice of three, through registration and the invite flow", async () => {
    const app = newApp();

    const [built] = await buildDummyPractices(siteOf(app), {
      practices: 1,
      label: "alpha",
    });

    const practices = app.database.select().from(practice).all();
    expect(practices).toHaveLength(1);
    expect(practices[0].name).toBe(built.practiceName);

    // The Owner and both Members, and the roles the two paths give them.
    expect(membershipsOf(app, built.owner)).toEqual([
      { practiceId: practices[0].id, role: "owner" },
    ]);
    for (const member of built.members) {
      expect(membershipsOf(app, member)).toEqual([
        { practiceId: practices[0].id, role: "member" },
      ]);
    }

    // Only registration writes these, and it writes one per Published Task.
    const entries = app.database
      .select()
      .from(taskEntry)
      .where(eq(taskEntry.practiceId, practices[0].id))
      .all();
    expect(entries).toHaveLength(98);

    // Both Invites were taken up on a Continue press, which is the only act
    // in the product that can mark one accepted.
    const invites = app.database.select().from(invite).all();
    expect(invites).toHaveLength(2);
    expect(invites.map((row) => row.email).sort()).toEqual(
      [...built.members].sort(),
    );
    expect(invites.every((row) => row.acceptedAt !== null)).toBe(true);
  });

  it("stops at the three-person cap rather than writing through it", async () => {
    const app = newApp();

    const [built] = await buildDummyPractices(siteOf(app), { practices: 1 });

    expect(membershipsOf(app, built.refused)).toEqual([]);
    expect(
      app.database.select().from(invite).where(eq(invite.email, built.refused)).all(),
    ).toEqual([]);
    // Nothing was sent to the address the cap turned away.
    expect(app.emailSender.linksTo(built.refused)).toEqual([]);
  });

  it("answers the Tailoring Wizard for some Practices and skips it for others", async () => {
    const app = newApp();

    const built = await buildDummyPractices(siteOf(app), { practices: 2 });

    expect(built.map((one) => one.tailoring).sort()).toEqual([
      "answered",
      "skipped",
    ]);

    const rows = app.database.select().from(practice).all();
    expect(rows).toHaveLength(2);
    // Settled either way: a skip is an answer, and both roads close the
    // screen for good.
    expect(rows.every((row) => row.tailoringSettledAt !== null)).toBe(true);

    const answered = rows.find((row) => row.state !== null);
    expect(answered).toBeDefined();
    expect(answered!.fixedLocation).not.toBeNull();
    expect(answered!.expectsEmployees).not.toBeNull();

    // The Wizard's whole job: Tasks the Practice will never need, set aside.
    const setAside = app.database
      .select()
      .from(taskEntry)
      .where(eq(taskEntry.practiceId, answered!.id))
      .all()
      .filter((entry) => entry.status === "not_applicable");
    expect(setAside.length).toBeGreaterThan(0);
  });

  it("leaves the Owner a Sign-in Link it did not press", async () => {
    const app = newApp();

    const [built] = await buildDummyPractices(siteOf(app), { practices: 1 });

    // Nothing delivers mail in development, so a link nobody spent is the
    // only way a developer gets into the Practice this just built.
    const link = new URL(built.signInLink);
    expect(link.pathname).toBe("/continue");

    app.clearCookies();
    const signedIn = await app.fetch("/continue", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: link.searchParams.get("token") ?? "" }),
    });
    expect(signedIn.headers.get("Location")).toBe("/tasks");
  });

  it("refuses a run longer than the product's own rate limiting allows", async () => {
    const app = newApp();

    await expect(
      buildDummyPractices(siteOf(app), {
        practices: MOST_PRACTICES_PER_RUN + 1,
      }),
    ).rejects.toThrow(DummyPracticeError);

    // Refused before anything was built, rather than half way through.
    expect(app.database.select().from(practice).all()).toEqual([]);
  });

  it("builds addresses nobody can ever receive, and says who they are", async () => {
    const app = newApp();

    const [built] = await buildDummyPractices(siteOf(app), {
      practices: 1,
      label: "beta",
    });

    for (const address of [built.owner, ...built.members, built.refused]) {
      // `.invalid` is reserved and undeliverable by definition, so a dummy
      // run that somehow reached a real mail provider still mails nobody.
      expect(address).toMatch(/@dummy\.invalid$/);
      expect(address).toContain("beta");
    }

    // Every address the run made is handed back, because a developer's next
    // act is signing in as one of them.
    const known = app.database
      .select({ email: user.email })
      .from(user)
      .where(isNotNull(user.email))
      .all()
      .map((row) => row.email);
    expect(known.sort()).toEqual([built.owner, ...built.members].sort());
  });
});

describe("a run of the tool itself", () => {
  /**
   * A database inside the checkout, because the tool refuses one outside it
   * — which is the guard doing its job, and `/tmp` is not development. It
   * goes under `data/`, which git ignores for exactly this reason.
   */
  function developmentDatabase(): string {
    const directory = mkdtempSync(join(process.cwd(), "data", "unseeded-"));
    onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
    return join(directory, "unseeded.sqlite");
  }

  it("refuses a database with no Task Library rather than building empty lists", async () => {
    // Migrated but never seeded, which is what a fresh checkout has: every
    // Practice this built would open on nothing at all.
    await expect(
      runDummyPractices({
        build: serverBuild,
        databaseFile: developmentDatabase(),
        practices: 1,
      }),
    ).rejects.toThrow(/npm run db:seed/);
  });

  it("refuses production itself, rather than trusting a caller to ask", async () => {
    // The CLI is not the only caller this module can ever have, and a guard
    // that lives in a wrapper is a guard the next wrapper forgets.
    await expect(
      runDummyPractices({
        build: serverBuild,
        databaseFile: developmentDatabase(),
        environment: { NODE_ENV: "production" },
      }),
    ).rejects.toThrow(NotDevelopmentError);
  });
});

describe("refusing to run against production", () => {
  const development = {
    environment: {} as NodeJS.ProcessEnv,
    databaseFile: "./data/launch-tasks.sqlite",
    workingDirectory: "/home/dev/launch-tasks",
  };

  it("runs where nothing says production", () => {
    expect(productionSigns(development)).toEqual([]);
    expect(
      productionSigns({
        ...development,
        environment: { APP_URL: "http://localhost:3000" },
      }),
    ).toEqual([]);
  });

  it("reads a secret nothing in development needs as somebody standing in production", () => {
    const signs = productionSigns({
      ...development,
      environment: { AUTH_SECRET: "a-real-one" },
    });

    expect(signs).toHaveLength(1);
    expect(signs[0]).toContain("AUTH_SECRET");
  });

  it("names every sign of production it can see, and refuses on any one", () => {
    const signs = productionSigns({
      environment: {
        NODE_ENV: "production",
        APP_URL: "https://launchtasks.directcaretools.com",
        AUTH_SECRET: "a-real-one",
      },
      databaseFile: "/data/launch-tasks.sqlite",
      workingDirectory: "/home/dev/launch-tasks",
    });

    expect(signs).toHaveLength(4);
    expect(signs.join("\n")).toContain("NODE_ENV");
    expect(signs.join("\n")).toContain("APP_URL");
    expect(signs.join("\n")).toContain("/data/launch-tasks.sqlite");
  });

  it("refuses on a database file outside the checkout on its own", () => {
    expect(
      productionSigns({ ...development, databaseFile: "/data/launch-tasks.sqlite" }),
    ).toHaveLength(1);
  });

  it("throws rather than returning, so a caller cannot forget to look", () => {
    expect(() => assertDevelopment(development)).not.toThrow();
    expect(() =>
      assertDevelopment({ ...development, environment: { NODE_ENV: "production" } }),
    ).toThrow(NotDevelopmentError);
  });
});
