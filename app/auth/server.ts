import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";

import {
  account,
  session,
  user,
  verification,
} from "~/database/schema";
import { MAIL_FROM, MAIL_REPLY_TO } from "~/services/email-sender";
import type { AppServices } from "~/services/services";
import { clientIpAddress } from "./client-ip";
import { appUrl, authSecret, trustedProxies } from "./config";
import { allowContinueAttempt, allowSignInLinkRequest } from "./rate-limit";

/**
 * The one module that imports Better Auth (ADR-0004).
 *
 * The single module is not tidiness; it is the exit. Better Auth is pre-2.0
 * and sits in the position that is hardest to reverse — the only door into a
 * product with no password — so if it goes the way of Lucia the replacement is
 * this file rewritten against a session implementation, and no route, loader
 * or component learns that anything changed. Everything below is therefore
 * expressed in the product's own words: request a Sign-in Link, continue from
 * one, who is signed in.
 *
 * `auth.handler` is never mounted. Every call is `auth.api.*` from our own
 * routes, and both endpoints set `requireHeaders: true`, so every call is
 * passed the request's headers or it throws.
 */

/**
 * How long a Sign-in Link lives. Ten minutes is tolerance for email latency
 * and nothing else: it does nothing about a mail scanner opening the link,
 * which is what the Continue Screen is for.
 */
export const SIGN_IN_LINK_LIFETIME_SECONDS = 600;

/** Where a Sign-in Link points: our own URL, never the plugin's. */
export const CONTINUE_PATH = "/continue";

export interface SignedInUser {
  id: string;
  email: string;
  name: string;
}

/**
 * What asking for a Sign-in Link can come to.
 *
 * There is deliberately no outcome for *sent* versus *not sent*. An address
 * over its limit, an address nobody has ever used and an address belonging to
 * a deleted Practice all return `accepted`, because the caller must not be
 * able to tell them apart — the answer is the only place an address could ever
 * leak. `invalid-address` is about the shape of what was typed and says
 * nothing about whether it is known.
 */
export type SignInLinkRequestOutcome = "accepted" | "invalid-address";

export async function requestSignInLink(
  services: AppServices,
  request: Request,
  email: string,
): Promise<SignInLinkRequestOutcome> {
  const auth = authFor(services);

  const response = await auth.api.signInMagicLink({
    body: { email },
    headers: request.headers,
    // Passing the request is what keeps `formCsrfMiddleware` alive: the
    // endpoint's own `use:` array still runs on a direct `auth.api` call, but
    // only when there is a request for it to inspect. Handing it one also
    // makes the call answer with a `Response` rather than a parsed body, which
    // is why the outcome is read off a status below.
    request,
    asResponse: true,
  });

  if (response.ok) return "accepted";
  if (response.status === 400) return "invalid-address";

  throw new Error(
    `Requesting a Sign-in Link failed with status ${response.status}`,
  );
}

/**
 * What pressing Continue can come to.
 *
 * `failed` is one outcome and not four. Used, expired, forged and
 * never-existed are byte-identical to the library and so they are byte
 * identical here: naming a cause would mean guessing, and the guess is wrong
 * in the forgery case.
 */
export type ContinueOutcome =
  | { status: "signed-in"; headers: Headers }
  | { status: "failed" }
  | { status: "too-many-attempts" };

export async function continueFromSignInLink(
  services: AppServices,
  request: Request,
  token: string,
): Promise<ContinueOutcome> {
  const ipAddress = clientIpAddress(request);

  // No derivable client IP means the per-IP control cannot count, and an
  // uncountable request is refused rather than waved through.
  if (!ipAddress) return { status: "too-many-attempts" };
  if (!allowContinueAttempt(services.database, ipAddress)) {
    return { status: "too-many-attempts" };
  }

  const auth = authFor(services);

  // No `callbackURL`: with one, success is a redirect of the library's
  // choosing, and where a physician lands after signing in is this app's
  // decision. Without one, success is a `200` carrying the session cookie and
  // every failure is a redirect to `?error=INVALID_TOKEN` — so `ok` is the
  // whole of the reading.
  const response = await auth.api.magicLinkVerify({
    query: { token },
    headers: request.headers,
    request,
    asResponse: true,
  });

  if (!response.ok) return { status: "failed" };
  return { status: "signed-in", headers: response.headers };
}

/** Who is signed in, or nobody. Read from the database on every request. */
export async function getSignedInUser(
  services: AppServices,
  request: Request,
): Promise<SignedInUser | null> {
  const auth = authFor(services);
  const result = await auth.api.getSession({ headers: request.headers });
  if (!result) return null;

  const { id, email, name } = result.user;
  return { id, email, name };
}

type Auth = ReturnType<typeof createAuth>;

/**
 * One Better Auth instance per set of services, built on first use.
 *
 * Keyed on the services object because that is what a database and a mail
 * sender arrive in: production has exactly one, and every test has its own
 * over its own SQLite file.
 */
const instances = new WeakMap<AppServices, Auth>();

function authFor(services: AppServices): Auth {
  let auth = instances.get(services);
  if (!auth) {
    auth = createAuth(services);
    instances.set(services, auth);
  }
  return auth;
}

function createAuth(services: AppServices) {
  const { database } = services;

  return betterAuth({
    appName: "Launch Tasks",
    baseURL: appUrl(),
    secret: authSecret(),
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema: { user, session, account, verification },
    }),

    // `session.cookieCache` is absent on purpose, and must stay absent. Turned
    // on, `getSession` is served from a signed cookie with no database read
    // and a revoked session stays alive for its `maxAge` — so an Owner
    // removing a Member would not actually remove them until the cache
    // expired. Better Auth's own documentation contradicts itself here: one
    // callout warns correctly while the same page claims a paragraph earlier
    // that revocation invalidates the cookie automatically. That sentence is
    // false as of 1.7.5, and it is the sentence a future reader would find if
    // they went looking for permission to turn this on. `test/sign-in.test.ts`
    // pins the behaviour it describes.

    advanced: {
      ipAddress: {
        // Unset, a multi-hop forwarded chain yields no client IP at all and
        // every IP-keyed control has to fail closed. `app/auth/config.ts`
        // refuses to start without it in production.
        trustedProxies: trustedProxies(),
      },
    },

    plugins: [
      magicLink({
        expiresIn: SIGN_IN_LINK_LIFETIME_SECONDS,
        // The default stores the token in plaintext, which would make a copy
        // of the database a drawer full of working links.
        storeToken: "hashed",
        // Sign-up stays on so the endpoint never looks a user up: a lookup is
        // the oracle this whole flow is built to avoid.
        disableSignUp: false,
        sendMagicLink: async ({ email, token }) => {
          // The per-address limit lives here, inside the sender, rather than
          // in front of the endpoint — in front of it, it would be a branch on
          // the address, and every caller would have learned something.
          if (!allowSignInLinkRequest(database, email)) return;

          // Read at the moment of sending, not when the instance is built: the
          // mail client is the one service a page can need nothing from, and
          // asking for it up front would make every signed-out page view
          // depend on it.
          await services.emailSender.send(signInLinkEmail(email, token));
        },
      }),
    ],
  });
}

/** The one email in v1 that the product cannot work without. */
function signInLinkEmail(email: string, token: string) {
  const url = new URL(CONTINUE_PATH, appUrl());
  url.searchParams.set("token", token);
  const link = url.toString();

  return {
    from: MAIL_FROM,
    replyTo: MAIL_REPLY_TO,
    to: email,
    subject: "Your Launch Tasks sign-in link",
    text: [
      "Open this link, then press Continue to sign in:",
      "",
      link,
      "",
      "The link lasts ten minutes and works once.",
      "If you did not ask to sign in, you can ignore this email.",
    ].join("\n"),
    html: [
      "<p>Open this link, then press Continue to sign in:</p>",
      `<p><a href="${link}">Sign in to Launch Tasks</a></p>`,
      "<p>The link lasts ten minutes and works once.</p>",
      "<p>If you did not ask to sign in, you can ignore this email.</p>",
    ].join("\n"),
  };
}
