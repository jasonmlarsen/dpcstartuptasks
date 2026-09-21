import type { RequestHandler } from "react-router";

import { appUrl } from "~/auth/config";
import { createServicesContext, type AppServices } from "~/services/services";
import { CookieJar } from "./cookie-jar";
import type { DevMailbox } from "./dev-mailbox";
import type { DummySite } from "./dummy-practices";

/**
 * A `DummySite` over the real request handler: one browser, one mailbox, one
 * connection.
 *
 * The browser is a `CookieJar` and an origin — the Owner's invite and the
 * Member's acceptance are only two acts of the same Practice because the
 * session cookie carries between them. The connection is the third thing, and
 * it is the one worth explaining.
 */
export function createDummySite(
  handler: RequestHandler,
  services: AppServices,
  mailbox: DevMailbox,
): DummySite {
  const cookies = new CookieJar();
  const origin = new URL(appUrl()).origin;
  const connection = dummyConnection();

  async function fetch(input: string, init?: RequestInit): Promise<Response> {
    const request = new Request(new URL(input, origin), init);

    const cookie = cookies.header();
    if (cookie) request.headers.set("Cookie", cookie);

    // The Continue Screen's POST mints a session and checks the origin a
    // browser always sends (`app/auth/origin.ts`).
    if (request.method !== "GET") request.headers.set("Origin", origin);

    // Say who is asking, because otherwise the answer is the developer.
    // `clientIpAddress` reads an unforwarded request in development as
    // `127.0.0.1`, so without this the run's Continue presses and the presses
    // of the browser the run exists to serve land in the *same* per-IP bucket
    // — and a tool whose output is a link a human must press would spend the
    // allowance for pressing it, handing them *Too many attempts* on their own
    // machine. A run is not the developer's browser and should not be counted
    // as it.
    request.headers.set("X-Forwarded-For", connection);

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

/**
 * A connection for one run, from TEST-NET-1 (RFC 5737) — reserved for
 * documentation and routable from nowhere, in the same spirit as the
 * `.invalid` addresses.
 *
 * Fresh per run rather than fixed, so two runs a few minutes apart get a
 * bucket each and the second is not refused half way through by the first.
 * Everyone in a single run shares it, which is both true — one process — and
 * what keeps `MOST_PRACTICES_PER_RUN` an honest number.
 */
function dummyConnection(): string {
  return `192.0.2.${1 + Math.floor(Math.random() * 254)}`;
}
