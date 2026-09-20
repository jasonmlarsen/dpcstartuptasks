import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, magicLink } from "better-auth/plugins";

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
  | { status: "signed-in"; headers: Headers; user: SignedInUser }
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

  // Who was just let in, read back through the session that was minted rather
  // than out of the verify response's body. The body's shape is the library's
  // and undocumented at this call; the cookie is the thing the next request
  // would arrive with anyway, so reading it is reading what happened.
  const signedIn = await auth.api.getSession({
    headers: new Headers({ Cookie: cookiePairs(response.headers) }),
  });

  if (!signedIn) {
    // Unreachable unless a version bump changed what a successful verify
    // leaves behind. Loudly, because the alternative is a physician landing on
    // an empty page with no Practice and no idea why.
    throw new Error("A Sign-in Link verified but minted no session.");
  }

  const { id, email, name } = signedIn.user;
  return {
    status: "signed-in",
    headers: response.headers,
    user: { id, email, name },
  };
}

/** The `name=value` halves of every cookie a response is setting. */
function cookiePairs(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/**
 * The role a User must hold to reach the admin panel.
 *
 * The plugin's default, kept: `admin` is what its own `adminRoles` looks
 * for, and renaming it would buy a word nobody reads and a setting that has
 * to agree with a SQL statement typed by hand on a server.
 */
export const ADMIN_ROLE = "admin";

/**
 * Who is signed in and is the Admin, or nobody.
 *
 * The role check lives here rather than at the routes, so that no page
 * learns the word `role`, that the guard is a column, or that Better Auth
 * has an `admin` plugin at all (ADR-0004). A route asks *is this the
 * Admin*, and the answer is a User or nothing.
 *
 * Nothing in the app ever writes this column. Promotion is a SQL statement
 * on the VPS — `docs/runbooks/admin-access.md` — which is not a limitation
 * of this function but the point of it: an endpoint that could grant the
 * role is an endpoint that can be attacked, and there are at most a handful
 * of Admins for the life of the product.
 *
 * The comparison is exact, and deliberately stricter than the plugin's own:
 * Better Auth reads `role` as a comma-separated list and would accept
 * `admin,user`. One value is the invariant the runbook's `UPDATE` writes,
 * and the strictness fails in the safe direction — a row nobody meant to
 * write is refused rather than let in. If that ever has to change, it
 * changes here and nowhere else.
 */
export async function getSignedInAdmin(
  services: AppServices,
  request: Request,
): Promise<SignedInUser | null> {
  const auth = authFor(services);
  const result = await auth.api.getSession({ headers: request.headers });
  if (!result) return null;

  const { id, email, name, role } = result.user;
  if (role !== ADMIN_ROLE) return null;

  return { id, email, name };
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

/**
 * End every session a User holds, right now.
 *
 * `revokeSession({ token })` is never used for this. Handed a token belonging
 * to someone else it skips the delete and still returns `{ status: true }` — a
 * silent no-op reporting success — because every public core endpoint is
 * self-scoped. The correct call is `auth.$context` → `deleteUserSessions`,
 * which is typed and exported but absent from the documented API pages, and
 * that semi-public status is why the revocation test at seam 1 is mandatory
 * (ADR-0004).
 *
 * "Immediately" honestly means "on the next request": auth resolves once at
 * the top of a request, so an in-flight document completes with the authority
 * it started with. The cost is one more page view, which is why an Owner
 * removing a Member revokes before it deletes.
 */
export async function revokeAllSessions(
  services: AppServices,
  userId: string,
): Promise<void> {
  const auth = authFor(services);
  const context = await auth.$context;
  await context.internalAdapter.deleteUserSessions(userId);
}

/**
 * Sign out whoever is holding this request's cookie.
 *
 * One session and not all of them, unlike `revokeAllSessions`: this is a
 * physician on a shared laptop pressing a button, not an Owner taking
 * somebody's access away, and ending their other devices' sessions would be
 * a surprise. The headers carry the cookie deletion, so the caller has to
 * hand them to the redirect it answers with.
 */
export async function signOut(
  services: AppServices,
  request: Request,
): Promise<Headers> {
  const auth = authFor(services);

  const response = await auth.api.signOut({
    headers: request.headers,
    asResponse: true,
  });

  return response.headers;
}

/**
 * Delete a User outright, sessions first.
 *
 * For a Member, Leaving *is* deleting: there is no account without a Practice,
 * so the one control that removes them from the Practice removes them from the
 * product. What they wrote stays behind, because a Note belongs to the
 * Practice and not to whoever typed it.
 */
export async function deleteUserAccount(
  services: AppServices,
  userId: string,
): Promise<void> {
  const auth = authFor(services);
  const context = await auth.$context;

  // Revoked before the row goes, so that the failure mode of a half-finished
  // delete is a person who cannot get in rather than one who still can.
  await context.internalAdapter.deleteUserSessions(userId);
  await context.internalAdapter.deleteUser(userId);
}

/**
 * Write a User's Display Name, which is the one thing about a User the
 * product itself asks for.
 *
 * It goes through this module rather than through an `UPDATE` in a domain
 * file because `name` is Better Auth's own column on Better Auth's own table
 * — unlike the two Email Consent columns, which are ours and sit there only
 * because a User is who consented.
 */
export async function setDisplayName(
  services: AppServices,
  userId: string,
  name: string,
): Promise<void> {
  const auth = authFor(services);
  const context = await auth.$context;
  await context.internalAdapter.updateUser(userId, { name });
}

/**
 * How long a Support View lasts, in seconds, and it never extends.
 *
 * An hour is long enough to reproduce a bug and short enough that a forgotten
 * tab is not a standing key into somebody's practice (#5).
 */
export const SUPPORT_VIEW_LIFETIME_SECONDS = 3600;

/** A Support View in progress, as seen from the request carrying it. */
export interface SupportViewSession {
  /** The Admin who is looking. */
  adminUserId: string;
  /** The Owner they are looking as. */
  targetUserId: string;
}

/**
 * Begin acting as another User.
 *
 * `impersonateUser` does three things at once, and all three matter: it
 * creates a **new session row owned by the target**, it stashes the Admin's
 * own session token in a separate signed `admin_session` cookie, and it swaps
 * the session cookie over. The first is why `deleteUserSessions` on the
 * target ends the view; the second is why the Admin's own account survives
 * that and can be handed back to them (ADR-0001).
 *
 * The returned headers carry every cookie of that swap, so the caller has to
 * answer with them. `expiresAt` is the hour, returned because the caller
 * records it — it is the only thing that can say afterwards whether the hour
 * had run out.
 */
export async function startActingAs(
  services: AppServices,
  request: Request,
  targetUserId: string,
  now: Date = new Date(),
): Promise<{ headers: Headers; expiresAt: Date } | null> {
  const auth = authFor(services);

  const response = await auth.api.impersonateUser({
    body: { userId: targetUserId },
    headers: request.headers,
    asResponse: true,
  });

  // The plugin refuses on its own account for reasons this app has already
  // ruled out upstream — no session, not the Admin, no such User, or a
  // target who is an Admin too. Nothing here can improve on *it did not
  // happen*, so the caller is told that and no more.
  if (!response.ok) return null;

  return {
    headers: response.headers,
    expiresAt: new Date(now.getTime() + SUPPORT_VIEW_LIFETIME_SECONDS * 1000),
  };
}

/**
 * Stop acting as another User, deliberately, while the borrowed session is
 * still alive.
 *
 * The library's own exit, and the only path where it works: it reads
 * `impersonatedBy` off the live session, so it is useless the moment that row
 * is gone — which is the whole reason `restoreAdmin` below exists.
 */
export async function stopActingAs(
  services: AppServices,
  request: Request,
): Promise<Headers | null> {
  const auth = authFor(services);

  const response = await auth.api.stopImpersonating({
    headers: request.headers,
    asResponse: true,
  });

  return response.ok ? response.headers : null;
}

/**
 * Whoever is signed in is being acted as by an Admin, or nobody is.
 *
 * Asked on every request, because the banner is owed on every page — so it
 * refuses on the cookie header before it touches the database. Without that,
 * every signed-out visit to the landing page would carry a session read for
 * a banner that could not possibly be shown.
 */
export async function currentlyActingAs(
  services: AppServices,
  request: Request,
): Promise<SupportViewSession | null> {
  if (!(request.headers.get("Cookie") ?? "").includes(SESSION_COOKIE)) {
    return null;
  }

  const auth = authFor(services);
  const result = await auth.api.getSession({ headers: request.headers });
  if (!result) return null;

  const adminUserId = result.session.impersonatedBy;
  if (!adminUserId) return null;

  return { adminUserId, targetUserId: result.user.id };
}

/**
 * The Admin's own account, handed back when the floor disappears underneath
 * them.
 *
 * Fires on any request where the session cookie resolves to nothing **and** a
 * valid `admin_session` cookie is present — which is every way a Support View
 * can end other than the Admin's own press: the hour, the Owner deleting the
 * Practice, the Purge. One path for all three, because building it only for
 * revocation would leave the most frequent version unfixed (#21).
 *
 * The **role check is the part that is easy to miss**. `stopImpersonating`
 * validates the restored session against `session.impersonatedBy`; this
 * cannot, because the row carrying `impersonatedBy` is the row that was
 * deleted. The `admin` role is what replaces it, and without it a stale
 * signed cookie would be a way back into somebody's account.
 *
 * Returns the headers that restore the Admin — their own session cookie
 * back, the stash expired — or null when there is nothing to hand back, in
 * which case the request is what it looks like: signed out.
 */
export async function restoreAdmin(
  services: AppServices,
  request: Request,
): Promise<{ headers: Headers; admin: SignedInUser } | null> {
  // The cheap refusal first, and it is the one almost every request takes:
  // no stash in the cookie header means no Support View has ever run in this
  // browser, and nothing below has to be built or read.
  if (!(request.headers.get("Cookie") ?? "").includes(ADMIN_SESSION_COOKIE)) {
    return null;
  }

  const auth = authFor(services);
  const context = await auth.$context;
  const cookie = context.createAuthCookie(ADMIN_SESSION_COOKIE);

  const stashed = await readSignedCookie(request, cookie.name, context.secret);
  if (!stashed) return null;

  // Still resolving to somebody means nothing has ended: either the Support
  // View is live, or the Admin is already back. Either way, hands off.
  const live = await auth.api.getSession({ headers: request.headers });
  if (live) return null;

  // `token:dontRememberMe`, the shape `impersonateUser` wrote.
  const [token] = stashed.split(":");
  if (!token) return null;

  const restored = await context.internalAdapter.findSession(token);
  if (!restored || restored.user.role !== ADMIN_ROLE) return null;

  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    serialiseCookie(
      context.authCookies.sessionToken.name,
      await signCookieValue(restored.session.token, context.secret),
      {
        ...context.authCookies.sessionToken.attributes,
        maxAge: context.sessionConfig.expiresIn,
      },
    ),
  );

  // The borrowed session was created `dontRememberMe`, which left a cookie
  // saying so. Left behind, it would stop the Admin's own session from ever
  // refreshing again.
  headers.append(
    "Set-Cookie",
    expiredCookie(context.authCookies.dontRememberToken),
  );

  // The stash is spent. Without this it outlives the view it belonged to by
  // days, because it inherits the session cookie's attributes (#21).
  headers.append("Set-Cookie", expiredCookie(cookie));

  const { id, email, name } = restored.user;
  return { headers, admin: { id, email, name } };
}

/**
 * Better Auth's name for the cookie the Admin's own session is stashed in.
 * Written only by `impersonateUser` and expired only by `stopImpersonating`
 * and by `restoreAdmin`; nothing else in 1.7.5 touches it.
 */
const ADMIN_SESSION_COOKIE = "admin_session";

/**
 * The tail of Better Auth's session cookie name, whatever prefix a
 * deployment gives it. Used only to refuse early; the cookie's value is
 * never read here.
 */
const SESSION_COOKIE = "session_token";

/**
 * A cookie with attributes, as Better Auth's own cookie getter describes one.
 */
interface CookieToSet {
  name: string;
  attributes: {
    domain?: string;
    httpOnly?: boolean;
    maxAge?: number;
    path?: string;
    secure?: boolean;
    sameSite?: string;
  };
}

/**
 * The three cookie helpers below are Better Auth's own, reimplemented here
 * because they are not exported.
 *
 * Signing is HMAC-SHA256 over the value, base64, appended after a `.` and
 * URI-encoded whole — twenty lines of `better-call`, which is a transitive
 * dependency of Better Auth and not one of ours. Vendoring the algorithm into
 * the one module that already owns this library is the smaller of the two
 * costs; the other is a direct dependency on a package nothing else here
 * imports, pinned by a library that is itself pre-2.0.
 *
 * The drift this risks is caught rather than hoped about: the Support View
 * tests run a real round trip both ways — `impersonateUser` writes the stash
 * and `readSignedCookie` verifies it, then `signCookieValue` writes the
 * session cookie and Better Auth's own `getSession` reads it back. A format
 * change in a version bump fails those tests rather than the rescue in
 * production.
 */
async function signCookieValue(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  const encoded = btoa(String.fromCharCode(...new Uint8Array(signature)));

  return encodeURIComponent(`${value}.${encoded}`);
}

/**
 * The value of a signed cookie, or null if it is absent or has been tampered
 * with.
 */
async function readSignedCookie(
  request: Request,
  name: string,
  secret: string,
): Promise<string | null> {
  const header = request.headers.get("Cookie");
  if (!header) return null;

  const raw = header
    .split(";")
    .map((pair) => pair.trim())
    .find((pair) => pair.slice(0, pair.indexOf("=")) === name);
  if (raw === undefined) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw.slice(raw.indexOf("=") + 1));
  } catch {
    return null;
  }

  const separator = decoded.lastIndexOf(".");
  if (separator < 1) return null;

  const value = decoded.slice(0, separator);
  const signature = decoded.slice(separator + 1);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

  let bytes: ArrayBuffer;
  try {
    const binary = atob(signature);
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
      .buffer as ArrayBuffer;
  } catch {
    return null;
  }

  const verified = await crypto.subtle.verify(
    "HMAC",
    key,
    bytes,
    new TextEncoder().encode(value),
  );

  return verified ? value : null;
}

function serialiseCookie(
  name: string,
  value: string,
  attributes: CookieToSet["attributes"],
): string {
  const parts = [`${name}=${value}`];

  if (typeof attributes.maxAge === "number") {
    parts.push(`Max-Age=${Math.floor(attributes.maxAge)}`);
  }
  if (attributes.domain) parts.push(`Domain=${attributes.domain}`);
  if (attributes.path) parts.push(`Path=${attributes.path}`);
  if (attributes.httpOnly) parts.push("HttpOnly");
  if (attributes.secure) parts.push("Secure");
  if (attributes.sameSite) {
    const sameSite = attributes.sameSite;
    parts.push(
      `SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1)}`,
    );
  }

  return parts.join("; ");
}

function expiredCookie(cookie: CookieToSet): string {
  return serialiseCookie(cookie.name, "", { ...cookie.attributes, maxAge: 0 });
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
      // The admin panel's guard, and Support View's engine. None of the
      // plugin's own endpoints are reachable — `auth.handler` is never
      // mounted (ADR-0004) — so installing it adds two columns and a
      // question, not a surface: `impersonateUser` and `stopImpersonating`
      // are called from `auth.api` by this file and by nothing else.
      admin({
        // The plugin's own default, written out rather than inherited: the
        // hour is a product decision (#5) and the one number a reader of
        // this file would come looking for. It does not extend — the
        // borrowed session is created `dontRememberMe`, which is what turns
        // Better Auth's rolling refresh off for it.
        impersonationSessionDuration: SUPPORT_VIEW_LIFETIME_SECONDS,
      }),

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
