# Research: revoking a removed Member's session in Better Auth

Ticket: [#12](https://github.com/jasonmlarsen/dpcstartuptasks/issues/12) (part of #1)
Researched: 2026-09-18
**Pinned to `better-auth@1.7.5`** (npm `latest`, published 2026-09-14). All source citations below were read from the `v1.7.5` git tag (`5468e6bfcdff799848537cf5ad06ebab15aad9dd`), not from `main`. Sources are Better Auth's own docs and source only. Anything not verified from a primary source is marked **[UNVERIFIED]**.

---

## TL;DR

**Yes, it works, and the answer is a one-liner — but not the one you'd reach for first.**

Sessions are genuinely database-backed: the `session_token` cookie is an **opaque identifier**, not a bearer of claims, and by default every authenticated request does a `findSession(token)` against SQLite. **Deleting the row is sufficient and immediate.**

Better Auth's *public* revocation endpoints (`revokeSession`, `revokeSessions`, `revokeOtherSessions`) are all hard-scoped to the caller's own `userId` and cannot touch another user's sessions. The admin plugin **does** carry cross-user revocation — `auth.api.revokeUserSession` / `auth.api.revokeUserSessions` — but both sit behind a `session:revoke` permission an Owner will never have, so they are the wrong tool for Owner-removes-Member.

The correct call is the one the admin plugin itself makes underneath:

```ts
const ctx = await auth.$context;
await ctx.internalAdapter.deleteUserSessions(userId);
```

`deleteUserSessions(userId)` is declared on the **exported public `InternalAdapter` interface** in `@better-auth/core`, and `auth.$context` is used in Better Auth's own migration guides. It is not a private escape hatch. It lives naturally behind `app/auth/server.ts` as `revokeAllSessionsForUser(userId)`.

**The one thing that can break this: `session.cookieCache`.** It defaults to **off**, and for this app it must *stay* off. With it on, a revoked session keeps working from the client's signed `session_data` cookie for up to `maxAge` (default 5 min) with **zero database reads**. Better Auth's own docs say so in a callout — and, two paragraphs earlier on the same page, say the opposite.

---

## 1. Is there a server-side API to revoke *another* user's sessions?

### The core session APIs: no. All three are self-scoped.

From `packages/better-auth/src/api/routes/session.ts` (v1.7.5):

| Endpoint | Server API | Scope |
|---|---|---|
| `POST /revoke-session` | `auth.api.revokeSession({ body: { token } })` | caller's own user only |
| `POST /revoke-sessions` | `auth.api.revokeSessions()` | caller's own user only |
| `POST /revoke-other-sessions` | `auth.api.revokeOtherSessions()` | caller's own user only |
| `GET /list-sessions` | `auth.api.listSessions()` | caller's own user only |

- https://www.better-auth.com/docs/concepts/session-management
- https://github.com/better-auth/better-auth/blob/v1.7.5/packages/better-auth/src/api/routes/session.ts

**`revokeSessions` and `revokeOtherSessions` don't take a user id at all** — they read `ctx.context.session.user.id` from the caller's own cookie. There is no parameter to point them at someone else.

**`revokeSession` takes a `token`, which looks promising, and is a trap.** Its handler, verbatim:

```ts
const session = await ctx.context.internalAdapter.findSession(token);
if (session?.session.userId === ctx.context.session.user.id) {
    await ctx.context.internalAdapter.deleteSession(token);
}
return ctx.json({ status: true });
```

Note the shape of the failure: if the token belongs to **another** user, the delete is skipped and the endpoint **still returns `{ status: true }`**. It fails silently and reports success. If anyone reaches for this as the removal mechanism, it will pass a naive test and leave the session alive. **Do not use `revokeSession` for cross-user revocation.**

(All three also sit behind `sensitiveSessionMiddleware`, which requires a *fresh* session — `session.freshAge`, default `60 * 60 * 24`. Another reason they are shaped for "manage my own devices," not for administration.)

### The admin plugin: yes, but gated behind a permission the Owner doesn't have.

The admin plugin — already in use in this app for `role` and Support View (#5) — does carry cross-user session APIs. From `packages/better-auth/src/plugins/admin/routes.ts`:

| Endpoint | Server API | Body | Permission checked in source |
|---|---|---|---|
| `POST /admin/list-user-sessions` | `auth.api.listUserSessions` | `{ userId }` | `session: ["list"]` |
| `POST /admin/revoke-user-session` | `auth.api.revokeUserSession` | `{ sessionToken }` | `session: ["revoke"]` |
| `POST /admin/revoke-user-sessions` | `auth.api.revokeUserSessions` | `{ userId }` | `session: ["revoke"]` |

- https://www.better-auth.com/docs/plugins/admin
- https://github.com/better-auth/better-auth/blob/v1.7.5/packages/better-auth/src/plugins/admin/routes.ts

**So the capability exists and is named. It is just not reachable by an Owner**, for two independent reasons:

1. **`adminMiddleware` requires an authenticated session on the request** (`getAuthoritativeSessionFromCtx`, else `UNAUTHORIZED`). A server-side `auth.api.revokeUserSessions({ body })` call with no `headers` throws.
2. **`hasPermission({ ..., permissions: { session: ["revoke"] } })` then runs against the caller's `role`.** The default statements (`packages/better-auth/src/plugins/admin/access/statement.ts`) grant `session: ["list", "revoke", "delete"]` to `admin` and `session: []` to `user`. An Owner is an Owner *of a Practice* — in this app's vocabulary, deliberately **not** an Admin — so they are the `user` role and get `FORBIDDEN` / `YOU_ARE_NOT_ALLOWED_TO_REVOKE_USERS_SESSIONS`.

Using this path for Owner-removes-Member would mean either granting every Owner the admin `session:revoke` permission (which also hands them `listUserSessions` across the whole install) or minting a synthetic admin session on the server to call your own HTTP endpoint. Both are worse than the direct call in §5.

**Doc discrepancy, minor:** the admin doc page lists `session:delete` as the permission for "Revoke All Sessions". The v1.7.5 source checks `session: ["revoke"]` for **both** revoke endpoints; `session:delete` is declared in the statement but is not what these two handlers test. Trust the source.

### Also worth knowing

- **`auth.api.banUser({ body: { userId } })` revokes as a side effect.** Its handler sets `banned: true` and then calls `ctx.context.internalAdapter.deleteUserSessions(ctx.body.userId)` — the docs state it "revokes all of their existing sessions", and the source backs that. But `banned` is a *global* flag meaning "cannot sign in to Launch Tasks at all". A Member removed from one Practice must still be able to sign in and, later, start their own. **Ban is the wrong verb here** even though it would technically end the session.
- The ban check itself is a `databaseHooks.session.create.before` hook (`packages/better-auth/src/plugins/admin/admin.ts`) — it only runs when a session is **created**. It does not re-check already-issued sessions. Ban's immediacy comes entirely from the `deleteUserSessions` call, not from the flag.
- `auth.api.removeUser({ body: { userId } })` deletes the user "and all their sessions and accounts" — again admin-gated, and it deletes the *user*, which is not what removing a Member from a Practice means.
- **[UNVERIFIED]** The organization plugin's `removeMember` is not used by this app, but for reference I found **no** session-revocation call anywhere under `packages/better-auth/src/plugins/organization/` — grepping for `deleteUserSessions|revokeSessions|deleteSession` returns nothing outside tests. If that plugin were ever adopted, removing a member would *not* end their session. Worth knowing; not load-bearing here.

---

## 2. Are sessions database-backed, such that deleting the row suffices?

**Yes — by default, unambiguously.**

The docs are explicit that the primary cookie is an opaque pointer, not a claims token:

> "The main `session_token` cookie is still the server-side session identifier." … "The primary `session_token` cookie is still an opaque session identifier and is not exposed through JWKS."
> — https://www.better-auth.com/docs/concepts/session-management

The `session` table is `id`, `token`, `userId`, `expiresAt`, `ipAddress`, `userAgent`. On every authenticated request the `/get-session` handler reads the signed cookie, then:

```ts
const session = await ctx.context.internalAdapter.findSession(sessionCookieToken);
ctx.context.session = session;
if (!session || session.session.expiresAt < new Date()) {
    deleteSessionCookie(ctx);
    return ctx.json(null);
}
```
(`packages/better-auth/src/api/routes/session.ts`)

`findSession` with no `secondaryStorage` configured goes straight to `adapter.findOne` on the `session` model (`packages/better-auth/src/db/internal-adapter.ts`). **No row → `null` → not authenticated, and the cookie is actively cleared on the response.** There is no in-memory session cache in the adapter.

The signed cookie's signature proves the *token string* wasn't tampered with. It carries no authority of its own — the authority is the row.

### The signed-cookie / JWT paths that would break this, and why none apply

Three things in Better Auth *can* make a session survive a deleted row. All are opt-in and all are off in this app's intended configuration:

1. **`session.cookieCache`** — the real one. See §3.
2. **Stateless mode.** Documented as `cookieCache: { enabled: true, maxAge: 7 * 24 * 60 * 60, strategy: "jwe", refreshCache: true }` plus `account.storeStateStrategy: "cookie"`. Better Auth applies this automatically **"if you don't provide a database"**. This app provides a database (Drizzle + SQLite), so stateless mode is not in play. `refreshCache` is additionally force-disabled with a logged warning when a database or secondary storage is configured (`packages/better-auth/src/context/create-context.ts`).
3. **The JWT plugin** (`/token`, `set-auth-jwt`) and the `bearer` plugin. Neither is in use. Note the docs' warning that cookie-cache JWTs and `/token` JWTs "are not interchangeable" — but more to the point, **any** JWT you mint is honoured until its own expiry regardless of the session row. If a JWT plugin is ever added for an API surface, this whole finding needs revisiting.

Two further options exist that change deletion semantics — `session.storeSessionInDatabase` and `session.preserveSessionInDatabase` — but both only take effect when `secondaryStorage` (Redis and friends) is configured. With plain SQLite, `deleteUserSessions` runs a straight `deleteMany` on `userId` with hooks. **[UNVERIFIED]** I did not exercise this against a live SQLite database; the claim is read from source, not observed.

**Conclusion for Q2: deleting the row is sufficient, provided `cookieCache` stays off.**

---

## 3. Is there a session cache that keeps a revoked session alive?

**Yes: `session.cookieCache`. It defaults to `false`. It must stay `false` in this app, and that should be an explicit, commented decision rather than an accident of not configuring it.**

From `packages/core/src/types/init-options.ts`, verbatim JSDoc:

```
cookieCache?: {
    /** max age of the cookie
     *  @default 5 minutes (5 * 60) */
    maxAge?: number;
    /** Enable caching session in cookie
     *  @default false */
    enabled?: boolean;
    /** @default "compact" */
    strategy?: "compact" | "jwt" | "jwe";
    ...
}
```

When enabled, Better Auth writes a **second** cookie, `session_data`, holding the serialized session and user, signed (`compact` = base64url + HMAC-SHA256; or `jwt`; or `jwe`, encrypted). On the next request `/get-session` decodes it and — this is the part that matters — **returns it without touching the database at all.** The only checks performed on the cached payload (`packages/better-auth/src/api/routes/session.ts`) are:

- does the cached `session.token` still match the `session_token` cookie;
- does the configured `cookieCache.version` (string or function) still match the cached `version`;
- has the cache payload's own `expiresAt` passed, or the cached session's `expiresAt` passed.

**None of those is a lookup for "does this row still exist."** A deleted row is invisible to all three.

Better Auth's own docs say this outright:

> "When `cookieCache` is enabled, revoked sessions may remain active on other devices until the cookie cache expires (`maxAge`). This is because: Cookie cache stores session data in the client's browser; The server cannot directly delete cookies from other devices; Sessions are only revalidated when the cache expires or `disableCookieCache: true` is used.
> **If immediate session revocation is critical:** Disable `cookieCache` entirely, or set a shorter `maxAge` (e.g. 60 seconds), or use `disableCookieCache: true` for sensitive operations."
> — https://www.better-auth.com/docs/concepts/session-management

**A documentation contradiction worth recording,** because it is exactly the kind of sentence that produces a wrong decision. Two paragraphs *above* that callout, the same page states:

> "If a session is revoked or expires, the cookie will be invalidated automatically."

That is **false for revocation** as of v1.7.5. The source path above performs no database read while the cache is valid. The callout is correct; the earlier sentence is not. **[UNVERIFIED]** — I did not find an issue or changelog entry acknowledging the contradiction; I am reporting it from reading the two against the source.

### How to disable or bound it

- **Disable (the recommendation):** simply do not set `session.cookieCache`, or set `enabled: false` explicitly. Default is off, so the safe posture is the default — but write it down, because the performance argument for turning it on is real and someone will make it later.
- **Bound it:** `maxAge: 60` caps the window at ~60s. Still a 60-second hole in which a removed Member can read the Practice.
- **Bypass per-call:** `disableCookieCache: true` on the query forces a database read and refreshes the cache. This is a *per-read* opt-out, so making it safe would mean remembering it at **every** authorisation point forever — precisely the discipline that fails once and fails silently. Not a substitute for leaving the cache off.
- `cookieCache.version` (a string, or a function of `(session, user)`) busts every cached cookie when the value changes. In principle a membership-generation counter could go here — but a function that has to consult the database to answer defeats the entire point of the cache. Mentioned for completeness, not recommended.

The honest trade-off: leaving `cookieCache` off means one SQLite `SELECT` on the `session` table per authenticated request. For ~50 practices on a single VPS with local SQLite, that is not a cost worth trading correctness for.

---

## 4. What happens to an in-flight request authorised moments before revocation?

**It completes, with full authority, as if nothing had happened. There is no interruption mechanism in Better Auth, and there is no first-class fix.**

This is structural, not a Better Auth defect. Authorisation is resolved **once**, at the start of request handling: `/get-session` (or the session middleware) reads the cookie, does `findSession`, and writes the result to `ctx.context.session`. Everything downstream reads that in-memory object. Deleting the row afterwards has no path to the already-resolved object, and nothing in the source cancels or re-checks mid-request. Grepping v1.7.5 turns up no revocation broadcast, no per-request revalidation hook, and no abort signal for this.

React Router v8 SSR sharpens it slightly: a document request fans out to multiple `loader`s that run concurrently, and if the session is resolved once per request and passed down (which is the right pattern), **all** of those loaders serve the removed Member's data. The window is the duration of one request — typically tens of milliseconds, but a slow loader widens it.

**What this actually costs you:** a removed Member can receive one more page of Practice data, the one already being rendered when the Owner clicked Remove. They cannot receive a second one. They cannot mutate anything after the transaction commits.

**What to do about it — mostly, accept it, but deliberately:**

- **Make the revocation and the membership deletion atomic.** Do the `membership` delete and `deleteUserSessions` in one SQLite transaction. This doesn't shrink the in-flight window, but it removes the much worse failure: a state where the Membership row is gone and the session is still live because the second call threw. SQLite on one box makes this cheap.
- **Order matters if you can't be atomic:** revoke the session *first*, then delete the Membership. A live session with no Membership fails the authorisation check on the next request; a dead session with a live Membership is merely a confusing login. The first ordering fails safe.
- **Do not add "belt and braces" per-request membership re-checks as a mitigation for this.** They don't close the window (they run at the same point in the request), and they add a second authorisation surface that can drift from the first.
- **Accept that "immediately" means "on the next request."** That is the correct, honest guarantee, and it is the same guarantee every database-backed session system gives. The hole #12 was raised about — a removed Member whose tab *keeps working indefinitely* — is fully closed. The remaining sliver is one request wide.

**[UNVERIFIED]** I found no Better Auth documentation addressing in-flight requests at all. The above is inferred from the request lifecycle in `packages/better-auth/src/api/routes/session.ts` and the absence of any contrary mechanism in v1.7.5 source. If Better Auth ever adds a revocation broadcast, this section is the one to revisit.

---

## 5. The workaround, and where it lives

First-class cross-user revocation *does* exist (admin plugin, §1) but is permission-gated away from the Owner. The smallest correct thing is to call what the admin plugin calls, directly.

### The call

```ts
// app/auth/server.ts — the only module that knows Better Auth exists.

/**
 * End every session belonging to a user, server-side, immediately.
 *
 * Better Auth's public revoke* endpoints are self-scoped, and the admin
 * plugin's revokeUserSessions requires the `session:revoke` permission an
 * Owner does not have. This is the call both of those make underneath.
 *
 * Pinned to better-auth@1.7.5. `deleteUserSessions` is declared on the
 * exported InternalAdapter interface in @better-auth/core
 * (packages/core/src/types/context.ts): "Delete every session belonging
 * to a user."  Re-verify on every minor upgrade.
 */
export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  const ctx = await auth.$context;
  await ctx.internalAdapter.deleteUserSessions(userId);
}
```

### Why this is legitimate and not a hack

- **`deleteUserSessions(userId): Promise<void>` is on the public, exported `InternalAdapter` interface** in `@better-auth/core` — `packages/core/src/types/context.ts`, re-exported from `packages/core/src/types/index.ts` — with the JSDoc *"Delete every session belonging to a user."* It is typed, documented in source, and not marked internal or deprecated.
- **`auth.$context` is used in Better Auth's own published documentation** — the Auth0, Clerk, WorkOS and Supabase migration guides all do `const ctx = await auth.$context` and reach for `ctx.internalAdapter` / `ctx.options`.
- **It is exactly what the admin plugin does.** `revokeUserSessions`' entire body after the permission check is `await ctx.context.internalAdapter.deleteUserSessions(ctx.body.userId)`. You are skipping the permission gate, which is the correct thing to skip, because your app has already performed its *own* authorisation — this Owner owns this Practice and this Member belongs to it.
- It honours database hooks: `deleteUserSessions` routes through `deleteManyWithHooks`, so any `databaseHooks.session.delete` logic still fires.

### The caveat, stated plainly

`$context.internalAdapter` is **semi-public**: exported and typed, but not featured on the docs' API pages. On a pre-2.0, fast-moving dependency that is a real risk — a rename here is a silent security regression, not a type error, if anyone ever loosens the types. Two things make that acceptable:

1. **It is one line behind `app/auth/server.ts`.** The blast radius of a breaking change is that one function, which is the entire point of the single-module rule #7 mandated.
2. **It must be covered by an integration test that actually asserts the hole is closed** — create a Member with a live session, remove them, then replay that exact session cookie against a Practice route and assert a 401/redirect rather than data. That test is what turns a Better Auth upgrade from a silent regression into a red build. Without it, pinning the version is theatre.

### Rejected alternatives

| Approach | Why not |
|---|---|
| `auth.api.revokeSession({ body: { token } })` | Self-scoped; silently no-ops and returns `{ status: true }` for another user's token. Actively dangerous. |
| `auth.api.revokeUserSessions` with an Owner's headers | `FORBIDDEN` — Owners are the `user` role, which has `session: []`. |
| Grant Owners the admin `session:revoke` permission | Also grants `listUserSessions` across the install; conflates Owner with Admin, which `CONTEXT.md` separates on purpose. |
| Mint a synthetic admin session server-side to call the admin endpoint | More moving parts, a standing privileged credential, and an HTTP round-trip to yourself — all to reach the same one-line call. |
| `auth.api.banUser` | Revokes sessions, but `banned` is global: the user could never sign in again, or start their own Practice. Wrong verb. |
| Delete the `session` rows with raw Drizzle | Would work, but bypasses `deleteManyWithHooks`, duplicates Better Auth's schema knowledge outside the auth module, and breaks if the session model is ever renamed or a secondary storage is added. Use the adapter. |
| `cookieCache` on, with `disableCookieCache: true` at auth checks | Requires perfect discipline at every authorisation point, forever, and fails silently when forgotten. |

### Applies to both #4 triggers

The same function covers both cases the ticket names:

- **Owner removes a Member** → in one transaction, delete the Membership and `revokeAllSessionsForUser(memberUserId)`.
- **Invite acceptance deletes the invitee's own Practice** → the invitee is the user whose Practice is going away. Their own session survives (they are actively using it to accept), but any *other* session they hold is now pointing at a deleted Practice. Revoke-all-then-reissue is the clean shape: `revokeAllSessionsForUser(inviteeUserId)` as part of the acceptance transaction, then let Better Auth set a fresh session cookie on the response. **[UNVERIFIED]** I did not verify the exact mechanics of minting a replacement session within the same request after a blanket revocation; note that `internal-adapter.ts` contains a comment that callers "may capture the revocation set before destructive work because a replacement session created by a later hook must remain active", which suggests the ordering is handled but which I did not trace end-to-end. **Flag for the implementation ticket.**

---

## 6. Configuration this pins down

```ts
export const auth = betterAuth({
  session: {
    // Deliberately NOT set. Enabling session.cookieCache lets a revoked
    // session keep working from a signed client-side cookie for up to
    // maxAge (default 5 min) with zero database reads — Better Auth's own
    // docs say so. Removing a Member must be immediate. Do not enable
    // this for performance without re-reading research/better-auth-revocation.md.
    // cookieCache: { enabled: false },
  },
  // Do NOT add the jwt() or bearer() plugins without revisiting revocation:
  // any minted JWT is honoured until its own expiry regardless of the session row.
});
```

Also standing: no `secondaryStorage`, no stateless mode, `database` always configured. Each of those, if changed, changes the answer to Q2.

---

## 7. Open items for the implementation ticket

1. **Integration test asserting the hole is closed.** Replay a removed Member's actual session cookie and assert it fails. This is the guard on the semi-public `internalAdapter` call and the guard against someone enabling `cookieCache` later. Non-optional.
2. **Transaction shape** for remove-Member and for invite-acceptance-deletes-Practice. Revoke-then-delete if not atomic.
3. **Re-issuing a session for the invitee** inside the same request as a blanket revocation. **[UNVERIFIED]** — see §5.
4. **Support View interaction (#5).** Impersonation creates a real session row with `impersonatedBy` set and `impersonationSessionDuration` default 1 hour. `deleteUserSessions(userId)` deletes **all** rows for that `userId` — so revoking a Member also kills an Admin's in-progress Support View of that Member. That is almost certainly correct behaviour, but it should be a decision, not a surprise.
5. **Upgrade discipline.** Pin `better-auth` to an exact version in `package.json`. On every minor bump, re-check: (a) `deleteUserSessions` still on `InternalAdapter`; (b) `cookieCache.enabled` still defaults `false`; (c) the `/get-session` cached path still performs no database read. `1.6.x` and `1.7.x` are both live release lines (`1.6.33` and `1.7.5` published six minutes apart on 2026-09-14).

---

## Sources

All source citations read from the `v1.7.5` tag, commit `5468e6bfcdff799848537cf5ad06ebab15aad9dd` (2026-09-14).

- https://www.better-auth.com/docs/concepts/session-management
- https://www.better-auth.com/docs/plugins/admin
- https://www.better-auth.com/docs/integrations/react-router
- https://github.com/better-auth/better-auth/blob/v1.7.5/packages/better-auth/src/api/routes/session.ts
- https://github.com/better-auth/better-auth/blob/v1.7.5/packages/better-auth/src/db/internal-adapter.ts
- https://github.com/better-auth/better-auth/blob/v1.7.5/packages/better-auth/src/cookies/index.ts
- https://github.com/better-auth/better-auth/blob/v1.7.5/packages/better-auth/src/context/create-context.ts
- https://github.com/better-auth/better-auth/blob/v1.7.5/packages/better-auth/src/plugins/admin/routes.ts
- https://github.com/better-auth/better-auth/blob/v1.7.5/packages/better-auth/src/plugins/admin/admin.ts
- https://github.com/better-auth/better-auth/blob/v1.7.5/packages/better-auth/src/plugins/admin/access/statement.ts
- https://github.com/better-auth/better-auth/blob/v1.7.5/packages/core/src/types/context.ts
- https://github.com/better-auth/better-auth/blob/v1.7.5/packages/core/src/types/init-options.ts
- https://github.com/better-auth/better-auth/blob/v1.7.5/docs/content/docs/concepts/session-management.mdx
- https://github.com/better-auth/better-auth/blob/v1.7.5/docs/content/docs/guides/auth0-migration-guide.mdx
- npm registry metadata for `better-auth`, read 2026-09-18 (`latest` `1.7.5` @ 2026-09-14T22:10:52Z; `release-1.6` `1.6.33` @ 2026-09-14T22:06:43Z)
- Prior findings: `.scratch/launch-tasks/research/magic-link-auth.md` (ticket #7)
