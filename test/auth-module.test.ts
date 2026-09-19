import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { assertAuthEnvironment } from "~/auth/config";

/**
 * Not a fifth seam: nothing here asks the product to do anything.
 *
 * These assert two rules ADR-0004 rests on that no request could ever reveal —
 * that Better Auth stays behind one module, and that a misconfigured container
 * refuses to start rather than starting and failing closed on every sign-in.
 * Both would otherwise be enforced by nothing but a reviewer's memory.
 */

const APP = new URL("../app", import.meta.url).pathname;

/** The one file allowed to know that Better Auth exists. */
const THE_EXIT = join(APP, "auth/server.ts");

describe("Better Auth lives behind one module", () => {
  it("is imported by `app/auth/server.ts` and by nothing else", () => {
    const importers = sourceFiles(APP).filter((file) =>
      /from\s+["']better-auth/.test(readFileSync(file, "utf8")),
    );

    expect(importers).toEqual([THE_EXIT]);
  });

  it("never reaches for `better-auth/react`", () => {
    // The login path is a plain `<form method="post">` at zero client JS, the
    // Continue button included. The client package is not installed and there
    // is nothing here for it to do.
    const reaching = sourceFiles(APP).filter((file) =>
      readFileSync(file, "utf8").includes("better-auth/react"),
    );

    expect(reaching).toEqual([]);
  });
});

describe("the startup assertion", () => {
  const good = {
    APP_URL: "https://launchtasks.directcaretools.com",
    AUTH_SECRET: "a-real-secret",
    TRUSTED_PROXIES: "10.0.1.7,172.18.0.0/16",
  };

  it("passes on a fully configured environment", () => {
    expect(() => assertAuthEnvironment(good)).not.toThrow();
  });

  it("refuses to start without a trusted proxy chain", () => {
    expect(() =>
      assertAuthEnvironment({ ...good, TRUSTED_PROXIES: undefined }),
    ).toThrow(/TRUSTED_PROXIES/);
  });

  it("refuses a trusted proxy entry that is not an address", () => {
    expect(() =>
      assertAuthEnvironment({ ...good, TRUSTED_PROXIES: "coolify-proxy" }),
    ).toThrow(/not an IP or CIDR range/);
  });

  it("refuses to start without an app URL or a secret", () => {
    expect(() => assertAuthEnvironment({ ...good, APP_URL: undefined })).toThrow(
      /APP_URL/,
    );
    expect(() =>
      assertAuthEnvironment({ ...good, AUTH_SECRET: undefined }),
    ).toThrow(/AUTH_SECRET/);
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory)
    .map((entry) => join(directory, entry))
    .flatMap((path) =>
      statSync(path).isDirectory()
        ? sourceFiles(path)
        : /\.tsx?$/.test(path)
          ? [path]
          : [],
    );
}
