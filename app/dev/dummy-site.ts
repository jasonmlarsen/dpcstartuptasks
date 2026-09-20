import type { RequestHandler } from "react-router";

import { appUrl } from "~/auth/config";
import { createServicesContext, type AppServices } from "~/services/services";
import { CookieJar } from "./cookie-jar";
import type { DevMailbox } from "./dev-mailbox";
import type { DummySite } from "./dummy-practices";

/**
 * A `DummySite` over the real request handler: one browser, one mailbox.
 *
 * The browser is a `CookieJar` and an origin, and nothing else — the Owner's
 * invite and the Member's acceptance are only two acts of the same Practice
 * because the session cookie carries between them.
 */
export function createDummySite(
  handler: RequestHandler,
  services: AppServices,
  mailbox: DevMailbox,
): DummySite {
  const cookies = new CookieJar();
  const origin = new URL(appUrl()).origin;

  async function fetch(input: string, init?: RequestInit): Promise<Response> {
    const request = new Request(new URL(input, origin), init);

    const cookie = cookies.header();
    if (cookie) request.headers.set("Cookie", cookie);

    // The Continue Screen's POST mints a session and checks the origin a
    // browser always sends (`app/auth/origin.ts`).
    if (request.method !== "GET") request.headers.set("Origin", origin);

    // A fresh context per request, exactly as in production: nothing a
    // loader writes into one may leak into the next.
    const response = await handler(request, createServicesContext(services));

    cookies.absorb(response);
    return response;
  }

  return {
    fetch,
    clearCookies: () => cookies.clear(),
    linksTo: (email) => mailbox.linksTo(email),
  };
}
