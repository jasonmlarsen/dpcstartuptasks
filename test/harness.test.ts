import { eq } from "drizzle-orm";
import { expect, onTestFinished, test } from "vitest";

import { HEALTH_CHECK_ROW_ID, healthCheck } from "~/database/schema";
import { createTestApp, type TestApp } from "./harness";

function freshApp(): TestApp {
  const app = createTestApp();
  onTestFinished(() => app.close());
  return app;
}

test("dispatches a request through the real app and renders the page", async () => {
  const app = freshApp();

  const response = await app.fetch("/");

  expect(response.status).toBe(200);
  expect(await response.text()).toContain("Launch Tasks");
});

test("a request, its response, and the row behind it", async () => {
  const app = freshApp();

  const response = await app.fetch("/health");

  expect(response.status).toBe(200);
  expect(await response.text()).toContain("LAUNCH_TASKS_OK");

  // The whole round trip: the app answered from this database, and this is the
  // row it answered from. Every later ticket's test is this shape.
  const row = app.database
    .select()
    .from(healthCheck)
    .where(eq(healthCheck.id, HEALTH_CHECK_ROW_ID))
    .get();
  expect(row?.keyword).toBe("LAUNCH_TASKS_OK");
});

test("/health fails when the row it reads is gone", async () => {
  const app = freshApp();

  // Standing in for the real failure — a file that is missing, unmigrated or
  // corrupt — without having to corrupt a file to do it.
  app.database
    .delete(healthCheck)
    .where(eq(healthCheck.id, HEALTH_CHECK_ROW_ID))
    .run();

  const response = await app.fetch("/health");

  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("LAUNCH_TASKS_OK");
});

test("each app gets its own database, so one test cannot see another's rows", async () => {
  const first = freshApp();
  const second = freshApp();

  first.database
    .delete(healthCheck)
    .where(eq(healthCheck.id, HEALTH_CHECK_ROW_ID))
    .run();

  expect(first.database.select().from(healthCheck).all()).toHaveLength(0);
  expect(second.database.select().from(healthCheck).all()).toHaveLength(1);
});

test("the fakes the app was built with are the ones the test can read", async () => {
  const app = freshApp();

  // Nothing routes to them yet — Resend and Kit are later tickets — but the
  // wiring is what seam 2 owes those tickets, so it is asserted here.
  expect(app.emailSender.sent).toEqual([]);
  expect(app.kitClient.calls).toEqual([]);
});
