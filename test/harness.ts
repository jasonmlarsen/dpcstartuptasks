import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { createRequestHandler } from "react-router";
import * as serverBuild from "virtual:react-router/server-build";

import { ADMIN_ROLE } from "~/auth/server";
import { createDatabase, type AppDatabase } from "~/database/database";
import { user } from "~/database/schema";
import { seed, TASK_LIBRARY_CSV_PATH } from "~/seed/seed";
import { createServicesContext, type AppServices } from "~/services/services";
import { FakeEmailSender } from "./fakes/fake-email-sender";
import { FakeKitClient } from "./fakes/fake-kit-client";

/**
 * Seam 1: the request seam, and the default way to test anything in this app.
 *
 * Every load-bearing path here is a plain form posting to an action at zero
 * client JS, so dispatching a `Request` and reading the `Response` is testing
 * the real thing rather than an approximation of it. A test asserts on what a
 * physician, a Member or the Admin can observe: the status, the redirect
 * target, the rendered text, the rows left behind, and what the two fakes were
 * handed. It never asserts that a function was called.
 */
export interface TestApp {
  /** Dispatch a request through the real handler. Cookies carry across calls. */
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
  /** The same database the routes just used, seeded, for asserting on rows. */
  database: AppDatabase;
  emailSender: FakeEmailSender;
  kitClient: FakeKitClient;
  /** Cookies the app has set so far, for asserting a session was established. */
  cookies: Map<string, string>;
  /** Drop the session without touching the database, to test a signed-out visit. */
  clearCookies(): void;
  /** Delete the temp database. Vitest calls this through `onTestFinished`. */
  close(): void;
}

/** Requests without an absolute URL are resolved against this origin. */
const TEST_ORIGIN = "http://localhost:3000";

/**
 * Build an app over a fresh SQLite file and two fakes.
 *
 * The file is a real file in a temp directory, migrated on open, seeded from
 * the cleaned CSV, and thrown away afterwards — there is no fixture framework
 * and no shared state to reset, because SQLite is a file (ADR-0005) and Task
 * Entries are eager (ADR-0003), so "the row does not exist yet" is never a
 * case to construct.
 *
 * Seeding here rather than per test is what lets every later test open a real
 * Task Library — the same 98 Tasks across 11 Phases a physician sees — without
 * asking for it or building a fixture that would drift from the real file.
 */
export function createTestApp(): TestApp {
  const directory = mkdtempSync(join(tmpdir(), "launch-tasks-"));
  const database = createDatabase(join(directory, "test.sqlite"));
  seed(database, TASK_LIBRARY_CSV_PATH);

  const emailSender = new FakeEmailSender();
  const kitClient = new FakeKitClient();
  const services: AppServices = { database, emailSender, kitClient };

  const handler = createRequestHandler(serverBuild, "test");
  const cookies = new Map<string, string>();

  async function fetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const request = toRequest(input, init);

    if (cookies.size > 0) {
      request.headers.set("Cookie", serialiseCookies(cookies));
    }

    // A fresh context per request: nothing a loader writes into it may leak
    // into the next request, exactly as in production.
    const response = await handler(request, createServicesContext(services));

    absorbSetCookies(response, cookies);
    return response;
  }

  return {
    fetch,
    database,
    emailSender,
    kitClient,
    cookies,
    clearCookies: () => cookies.clear(),
    close: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function toRequest(
  input: string | URL | Request,
  init?: RequestInit,
): Request {
  if (input instanceof Request) return new Request(input, init);

  const url = new URL(input, TEST_ORIGIN);
  const request = new Request(url, init);

  // Our own origin check on the Continue Screen's POST needs this header, and
  // a browser always sends it. Tests exercising a cross-origin POST override it.
  if (request.method !== "GET" && !request.headers.has("Origin")) {
    request.headers.set("Origin", url.origin);
  }
  return request;
}

function serialiseCookies(cookies: Map<string, string>): string {
  return [...cookies]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

/**
 * Keep the cookie jar in step with the response, deletions included: a
 * revocation test is only meaningful if clearing a cookie actually clears it.
 */
function absorbSetCookies(response: Response, cookies: Map<string, string>) {
  for (const header of response.headers.getSetCookie()) {
    const [pair, ...attributes] = header.split(";");
    const separator = pair.indexOf("=");
    if (separator === -1) continue;

    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();

    const expired = attributes.some((attribute) => {
      const [key, raw] = attribute.split("=");
      const lowered = key.trim().toLowerCase();
      if (lowered === "max-age") return Number(raw) <= 0;
      if (lowered === "expires") return new Date(raw ?? "").getTime() <= Date.now();
      return false;
    });

    if (expired || value === "") {
      cookies.delete(name);
    } else {
      cookies.set(name, value);
    }
  }
}

/**
 * Sign in the way a physician does: the registration form, the email, the
 * Continue Screen.
 *
 * There is no shortcut here on purpose — a fixture that inserted a Practice
 * and a session directly would skip the one act that creates a Task Entry for
 * every Task, and every test of the list would then be testing a Practice
 * that no registration ever produced. The first call for an address registers
 * it; every call after that just signs it back in.
 *
 * The Tailoring Wizard stands between a new Owner and the list, so this
 * presses its Skip by default — through the real form, not by writing the
 * flag — which leaves the Practice with all 98 Tasks not started, exactly as
 * every test of the list assumes. A test of the Wizard itself passes
 * `tailoring: "owed"` and meets the screen where a physician meets it.
 */
export async function signInAs(
  app: TestApp,
  email: string,
  options: { emailConsent?: boolean; tailoring?: "skip" | "owed" } = {},
): Promise<Response> {
  const { emailConsent = true, tailoring = "skip" } = options;

  const body = new URLSearchParams({ email });
  // An unticked checkbox is absent from the submission, which is how a
  // browser posts one and how a physician declines.
  if (emailConsent) body.set("emailConsent", "on");

  await app.fetch("/sign-in", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const links = app.emailSender.linksTo(email);
  const link = links.at(-1);
  if (!link) throw new Error(`No Sign-in Link was mailed to ${email}`);
  const token = new URL(link).searchParams.get("token") ?? "";

  const signedIn = await app.fetch("/continue", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });

  // A no-op for anyone the Wizard is not owed to — a Member, or an Owner who
  // has already answered — because its action redirects to the list untouched.
  if (tailoring === "skip") await skipTailoringWizard(app);

  return signedIn;
}

/** Press Skip on the Tailoring Wizard, as a physician does. */
export async function skipTailoringWizard(app: TestApp): Promise<Response> {
  return app.fetch("/welcome", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ intent: "skip" }),
  });
}

/**
 * Promote a User to Admin the only way the product allows: a SQL statement.
 *
 * There is no function in `app/` to call here, and that is the feature
 * being exercised rather than a gap in the harness — promotion is an
 * `UPDATE` typed on the VPS (`docs/runbooks/admin-access.md`), so a test
 * that reached for an app-side helper would be testing a door the spec says
 * must not exist. This is that statement, against the test's own file.
 */
export function promoteToAdmin(app: TestApp, email: string): void {
  const changed = app.database
    .update(user)
    .set({ role: ADMIN_ROLE })
    .where(eq(user.email, email))
    .run();

  if (changed.changes === 0) {
    throw new Error(`No user to promote: ${email}`);
  }
}
