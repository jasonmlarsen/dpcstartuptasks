# Research: prefetch burn, rate limiting and enumeration in Better Auth 1.7.5

Ticket: [#19](https://github.com/jasonmlarsen/dpcstartuptasks/issues/19) (part of #1)
Researched: 2026-09-18
**Pinned to `better-auth@1.7.5`.** Every citation below was read from the `v1.7.5` git tag (`5468e6bfcdff799848537cf5ad06ebab15aad9dd`), not from `main` — the same discipline [#12](https://github.com/jasonmlarsen/dpcstartuptasks/issues/12) established. Where the docs and the source disagree, the source wins and the disagreement is named. Anything not verified from a primary source is marked **[UNVERIFIED]**.

Paths are relative to the repo root of `better-auth/better-auth`. Prefix any path with `https://github.com/better-auth/better-auth/blob/v1.7.5/` to read it.

---

## TL;DR

**1. Prefetch burn is real, unmitigated, and has no knob.** `/magic-link/verify` is a `GET` that consumes the token atomically before anything else happens. There is no interstitial, no POST-confirm step, no "don't consume on GET" option — `MagicLinkOptions` has exactly seven fields and none of them touch this. The only tuning available is `expiresIn` (default 300s), which makes the window *narrower*, not safer. A second click, an expired link, a forged token and a token that never existed all produce the byte-identical redirect `?error=INVALID_TOKEN`. **A re-click is not distinguishable from a forgery — not by the library, and not by us downstream of it.** Any "your link was already used, here's a fresh one" affordance is ours to build, and it cannot be built on the error code alone.

**2. Rate limiting ships, defaults are not what the docs say, and — the finding that matters — the architecture ADR-0004 commits to bypasses it entirely.** The limiter lives in the router's `onRequest` hook. `auth.api.*` is a *different object*, built by `getEndpoints`, that never enters the router. ADR-0004 says the flow "runs from a plain `<form method="post">` to a React Router action calling `auth.api.*`". **Under that design there is zero rate limiting on the only door into the product**, no matter what `rateLimit` is set to. Better Auth's docs say this plainly in a callout; ADR-0004's "rate limiting on database storage and enabled in development" consequence is, as written, inert.

Two further traps, assuming the handler path is used instead: the key is `${ip}|${path}` — **there is no per-address axis anywhere in 1.7.5** — and if `advanced.ipAddress.trustedProxies` is unset behind a multi-hop proxy, every request in the world collapses into **one shared bucket of 5 requests per 60 seconds**. That is not a weak limit; it is an accidental global kill switch.

**3. Enumeration is closed, and closed for a good reason: the endpoint has no branch to leak.** `/sign-in/magic-link` never looks up the user. It mints a token, writes a row, calls `sendMagicLink`, returns `{ status: true }`. Status, body and server-side timing are identical for a known and an unknown address. There is no setting because there is nothing to configure. The exposure that remains is entirely ours: any check *we* add in front of the endpoint (a cap check, a "known physician" gate) reintroduces the oracle the library carefully avoids. Better Auth's named "Email Enumeration Protection" feature is for email+password sign-up and is irrelevant here — do not cargo-cult it.

**The invite flow cannot leak yet because it does not exist.** The `magicLink` plugin has no invite concept, and the organization plugin is not adopted (`CONTEXT.md:11` explicitly avoids the word). Whatever [#17](https://github.com/jasonmlarsen/dpcstartuptasks/issues/17) builds owns this question outright.

---

## 1. Link-prefetch token burn

### 1.1 Yes, it verifies on GET, and yes, the token dies at that moment

`packages/better-auth/src/plugins/magic-link/index.ts:298-302`:

```ts
magicLinkVerify: createAuthEndpoint(
    "/magic-link/verify",
    {
        method: "GET",
```

The handler's *first* substantive act, `:386-393`:

```ts
const storedToken = await storeToken(ctx, token);
const tokenValue =
    await ctx.context.internalAdapter.consumeVerificationValue(
        storedToken,
    );
if (!tokenValue) {
    redirectWithError("INVALID_TOKEN");
}
```

Nothing is checked before the consume. No `HEAD`/`GET` distinction, no `Sec-Purpose: prefetch` sniff, no user-agent heuristic, no confirmation gate. **Any HTTP client that issues a `GET` to that URL spends the token** — a corporate mail scanner, a link-safety rewriter, a browser prefetcher, an inbox preview generator.

The consume is genuinely atomic and genuinely destructive. `packages/better-auth/src/db/internal-adapter.ts:1390-1504` documents and implements it: the first concurrent caller gets the row, everyone else gets `null`, and the delete is wrapped in a transaction or local lock (`:1446-1484`). Its own comment, `:1371-1384`:

> Atomically consume a single-use verification row by `identifier` and return it. The first concurrent caller receives the latest row for the identifier; every other caller racing against it receives `null`. […] Rows past their `expiresAt` are treated as already invalid: the row is still deleted (so it cannot be replayed later) but `null` is returned.

This is correct, deliberate engineering. It is also exactly why a scanner is fatal: there is no second attempt by design. `allowedAttempts` is deprecated in source specifically because of it (`plugins/magic-link/index.ts:36-46`):

> Multi-attempt verification is no longer supported. Each magic link token is consumed atomically on the first verification call, so a given token mints at most one session regardless of this value.

Setting it to anything other than `1` is ignored and emits a `console.warn` at plugin construction (`:168-172`). **There is no version of 1.7.5 in which a token survives a scanner hit.**

### 1.2 Built-in interstitial, POST-confirmation, or "don't consume on GET" — all absent

`MagicLinkOptions` (`plugins/magic-link/index.ts:28-97`) is the entire configuration surface of this plugin. In full, seven fields:

| Option | Default | Lines |
|---|---|---|
| `expiresIn` | `60 * 5` (300s) | `:29-33` |
| `allowedAttempts` | `1`, **deprecated and ignored** | `:35-46` |
| `sendMagicLink` | required | `:47-58` |
| `disableSignUp` | `false` | `:59-64` |
| `rateLimit` | `{ window: 60, max: 5 }` | `:65-78` |
| `generateToken` | `generateRandomString(32, "a-z", "A-Z")` | `:79-82` |
| `storeToken` | `"plain"` | `:84-96` |

Nothing here defers, gates, or confirms. The plugin registers exactly two endpoints (`:191-472`) and there is no third "confirm" route. I searched the docs at the tag for `prefetch`, `scanner`, `interstitial` and `confirm` in `docs/content/docs/plugins/magic-link.mdx` and found **no acknowledgement of the failure mode at all** — the only `confirm` hit is unrelated (`:104`, about unverified pre-existing accounts).

This confirms and upgrades the `[UNVERIFIED]` note carried in [#7](https://github.com/jasonmlarsen/dpcstartuptasks/issues/7)'s findings (`magic-link-auth.md`, "GET-consumes-token"): it is no longer an inference from the HTTP method. **It is verified absent from the option surface, the endpoint list and the documentation.** An interstitial is ours to build, and the shape is forced: our own route receives the token, renders a page, and only a subsequent `POST` from that page calls `auth.api.magicLinkVerify`. The library will not help, but it will not fight us either — `magicLinkVerify` is a normal server API.

### 1.3 TTL: 300 seconds, configurable, and one token is 182 bits

`plugins/magic-link/index.ts:245-249`:

```ts
await ctx.context.internalAdapter.createVerificationValue({
    identifier: storedToken,
    value: JSON.stringify({ email, name: ctx.body.name }),
    expiresAt: new Date(Date.now() + (opts.expiresIn || 60 * 5) * 1000),
});
```

Default 300 seconds; `expiresIn` is a plain number of seconds and there is no ceiling or floor enforced. Docs agree here (`docs/content/docs/plugins/magic-link.mdx:135`). ADR-0004 already pins `expiresIn: 600`, which is fine and is the right direction — **but note it interacts badly with prefetch.** A longer TTL does not help a burned token; the token is gone, not stale. Lengthening `expiresIn` buys tolerance for *email latency* only.

Expiry is enforced in exactly one place, the last gate of the consume (`db/internal-adapter.ts:1500-1503`):

```ts
// Single expiry gate. A row past its `expiresAt` is treated as already
// invalid, so callers can rely on a non-null return meaning "valid".
if (!consumed || consumed.expiresAt < new Date()) return null;
```

Note the consequence for §1.4: **an expired row is deleted and reported as `null`, identical to a missing one.**

Token strength, for the record: `generateRandomString(32, "a-z", "A-Z")` (`:243`) is 32 characters over a 52-symbol alphabet, ≈182 bits. The generator is `createRandomStringGenerator` from `@better-auth/utils`, pinned at `0.4.2` by the workspace catalog (`pnpm-workspace.yaml:67`); `0.4.2`'s `dist/random.mjs:39-48` uses `crypto.getRandomValues` with rejection sampling (`if (rand < maxValid)`) to avoid modulo bias. **Guessing is not a threat model here.** (The generator lives in a separate repository, so this one claim was verified from the published npm tarball of the pinned version rather than from the `v1.7.5` tree.)

`storeToken` defaults to `"plain"` (`:163`) — the emailed bearer token is written to SQLite verbatim. ADR-0004 already pins `"hashed"` (`:175-177`). That remains correct and is reaffirmed here.

### 1.4 A second use is indistinguishable from a forgery. Confirmed, and worse than expected

The failure path, `plugins/magic-link/index.ts:366-378`:

```ts
function redirectWithError(
    error: string,
    description?: string | undefined,
): never {
    errorCallbackURL.searchParams.set("error", error);
    if (description) {
        errorCallbackURL.searchParams.set("error_description", description);
    }
    throw ctx.redirect(errorCallbackURL.toString());
}
```

`INVALID_TOKEN` (`:392`) is emitted when `consumeVerificationValue` returns `null`. From §1.1 and §1.3, that is `null` for **all four** of:

1. a token already consumed (the real user clicked twice, or clicked after a scanner),
2. a token past `expiresAt` (deleted and reported invalid in the same breath),
3. a forged or guessed token,
4. a token from a different deployment / stale database.

There is no `error_description` on this path, no distinct code, no `Retry-After`, nothing. The redirect is byte-identical. **The library gives us no signal on which to build a kind error message.** Anything the user sees that says "this link was already used" is a guess we are making, and it is a guess that is wrong for case 3.

Two mechanical notes for whoever implements the error screen:

- The redirect target is `errorCallbackURL` if supplied, otherwise `callbackURL` (`:359-364`). The sign-in handler **always** sets `callbackURL`, defaulting to `"/"` (`:259`), so a link minted by this plugin always redirects and never returns the JSON body — the `ctx.json({ token, user, session })` branch at `:459-465` is unreachable for emailed links. Plan the error UI around a redirect with `?error=` in the query string, not around a response body.
- Every callback URL is origin-checked by three stacked `originCheck` middlewares (`:303-319`), so `errorCallbackURL` cannot be pointed off-site. That protection is endpoint-level, not router-level, so it survives direct `auth.api` invocation (see §2.6).

### 1.5 What we would have to build

| Capability | 1.7.5 |
|---|---|
| Verify on GET | **yes, unconditionally** |
| Single-use at that moment | **yes, atomic** |
| Interstitial / POST-confirm | **absent** |
| "Don't consume on GET" option | **absent** |
| Configurable TTL | yes, `expiresIn`, default 300s |
| Re-click distinguishable from forgery | **no — identical `?error=INVALID_TOKEN`** |
| Automatic re-issue on burn | **absent** |

---

## 2. Rate limiting on the sign-in endpoint

### 2.1 It ships, and it is on by default in production only

`packages/better-auth/src/api/rate-limiter/index.ts` is the whole implementation. Defaults are resolved in `packages/better-auth/src/context/create-context.ts:354-362`:

```ts
rateLimit: {
    ...options.rateLimit,
    enabled: options.rateLimit?.enabled ?? isProduction,
    window: options.rateLimit?.window || 10,
    max: options.rateLimit?.max || 100,
    storage:
        options.rateLimit?.storage ||
        (options.secondaryStorage ? "secondary-storage" : "memory"),
},
```

**On in production, off in development**, unless `enabled` is set explicitly. ADR-0004's instinct to force it on in development is right — the alternative is that the one control you most want to exercise is the one never exercised locally.

### 2.2 The documented default window is wrong

`docs/content/docs/concepts/rate-limit.mdx:7-10` at the tag:

> Better Auth includes a built-in rate limiter to help manage traffic and prevent abuse. By default, in production mode, the rate limiter is set to:
> * Window: 60 seconds
> * Max Requests: 100 requests

The source says `window: 10`. The docs page then contradicts *itself* thirteen lines later, in its own example (`:23-24`):

```ts
rateLimit: {
    window: 10, // time window in seconds
    max: 100, // max requests in the window
}
```

**Believe the source: the global default is 10 seconds / 100 requests.** This is the second documented-default error [#12](https://github.com/jasonmlarsen/dpcstartuptasks/issues/12)'s discipline has caught in this library, which is itself a finding: treat every default in Better Auth's prose as unverified until read at the tag.

(In practice the global default never applies to our paths — see §2.4 — so this particular error costs us nothing. It is recorded because the *pattern* costs us.)

### 2.3 Storage: memory by default, pluggable four ways, and memory is fine for us

`rate-limiter/index.ts:270-328` resolves the backend. The precedence is `customStorage` → `secondary-storage` → `memory` → database.

The memory backend is a module-level `Map` (`:16`), capped at 100,000 entries (`:21`) with expired entries swept on every access and oldest-first eviction past the cap (`:23-42`). Its `consume` is a read-decide-write with an explicit comment that single-threaded JS makes it atomic (`:305-324`).

The configuration surface, `packages/core/src/types/init-options.ts:251-293`:

- `enabled?: boolean` — `:256-260`
- `customRules?: { [path]: rule | false | (req, currentRule) => rule | false }` — `:261-275`
- `storage?: "memory" | "database" | "secondary-storage"` — `:276-285`
- `customStorage?: BetterAuthRateLimitStorage` — `:286-292`
- plus `window` / `max` / `modelName` / `fields` inherited from the rule and DB option types (`:251-255`).

**Confirming rather than assuming, as the ticket asked: in-memory is acceptable for this app.** One container, one process, one SQLite file means one `Map` and no coherence problem — the atomicity argument in the source comment holds exactly. The single real cost is that **the counter resets on every process restart**, and Coolify redeploys restart the container. An attacker who can trigger or wait out a redeploy gets a fresh budget. Given the abuse we are defending against (a bored person hammering a login form, not a funded adversary), that is a reasonable trade — but it is a trade, and `storage: "database"` is one line away if we decide it is not. The database backend is written carefully: guarded `incrementOne` on both window and count so a concurrent burst cannot exceed the max (`rate-limiter/index.ts:193-223`), with best-effort pruning of expired rows (`:226-240`). ADR-0004 already pins `storage: "database"`; nothing found here argues against it, and §2.5 argues mildly *for* it.

### 2.4 What the sign-in endpoint actually gets: 5 per 60s, per IP, per path

Rules are resolved in `resolveRateLimitConfig` (`rate-limiter/index.ts:337-410`) in four layers, each overriding the last:

1. **Global** — `ctx.rateLimit.window` / `.max` (`:340-341`), i.e. 10s/100.
2. **Built-in special rules** (`:360-366`, defined `:439-468`): `/sign-in`, `/sign-up`, `/change-password`, `/change-email` → **10s / 3**; `/request-password-reset`, `/send-verification-email`, `/forget-password`, the email-OTP send paths → **60s / 3**.
3. **Plugin rules** (`:368-379`) — and note this loop runs *after* the special rules and `break`s on first match, so **a plugin rule overrides the built-in special rule.**
4. **`customRules`** (`:381-407`), matched by exact path or wildcard, resolvable by a function, and `false` disables rate limiting for that path entirely.

The magic-link plugin registers a rule covering both its endpoints (`plugins/magic-link/index.ts:473-484`):

```ts
rateLimit: [
    {
        pathMatcher(path) {
            return (
                path.startsWith("/sign-in/magic-link") ||
                path.startsWith("/magic-link/verify")
            );
        },
        window: opts.rateLimit?.window || 60,
        max: opts.rateLimit?.max || 5,
    },
],
```

So the effective limit on `/sign-in/magic-link` is **60 seconds / 5 requests**, from layer 3, *overriding* the stricter 10s/3 of layer 2. `/magic-link/verify` gets its own separate bucket at the same 60s/5, because the key includes the path.

**This is configurable, and the option is undocumented.** `magicLink({ rateLimit: { window, max } })` exists in `MagicLinkOptions` (`plugins/magic-link/index.ts:65-78`) and is honoured at `:481-482`, but the string `rateLimit` does not appear anywhere in `docs/content/docs/plugins/magic-link.mdx`. A reader of the docs alone would not know the option exists, and would also not know that their plugin quietly *loosens* the built-in `/sign-in` limit from 3-per-10s to 5-per-60s.

The rejection response (`rate-limiter/index.ts:94-107`) is `429` with body `{"message":"Too many requests. Please try again later."}` and a header named **`X-Retry-After`** — not the standard `Retry-After`. Worth knowing before writing the UI or a proxy rule against it.

### 2.5 Per-IP only. There is no per-address axis, and the IP itself is fragile

The key, `packages/core/src/utils/ip.ts:395-399`:

```ts
export function createRateLimitKey(ip: string, path: string): string {
    // Use | as separator to prevent collision attacks
    return `${ip}|${path}`;
}
```

That is the entire keying scheme. **There is no per-email, per-address or per-account rate limiting anywhere in 1.7.5.** The limiter runs in `onRequest` (§2.6), before the body is parsed, so it structurally *cannot* see the email. Nothing in `customRules` helps: a custom rule function receives the `Request` and may return a different window/max, but it cannot change the key. **Per-address limiting — "stop mailing this one physician 40 links" — must be built by us, inside `sendMagicLink` or in front of the endpoint, against our own table.** This is the single largest gap in this section.

The IP half is fragile in a way that matters on a VPS behind a reverse proxy. `getIP` (`ip.ts:354-385`) reads `x-forwarded-for` by default (`:346`, `:364-365`) and hands it to `getIPFromHeader` (`:293-343`), which:

- with `trustedProxies` configured, walks the chain right-to-left to the first untrusted hop (`:317-331`), failing closed on a malformed hop (`:321-324`);
- **without** `trustedProxies`, trusts a header only if it holds exactly one value (`:333-340`) — `if (forwardedIps.length !== 1) return null;`

So a two-hop chain (a CDN in front of the app's proxy, or a proxy that appends rather than replaces) with no `trustedProxies` configured yields `null`. The limiter then does this (`rate-limiter/index.ts:332-359`):

```ts
const NO_TRUSTED_IP_KEY = "no-trusted-ip";
...
// Fail closed when no client IP can be derived: key on a shared per-path
// bucket and still enforce the limit, instead of skipping rate limiting
// entirely (which let a client omit the IP header to bypass the limit).
const key = createRateLimitKey(ip ?? NO_TRUSTED_IP_KEY, path);
```

Failing closed is the right call for a limiter in general. **Here it is a footgun.** On `/sign-in/magic-link` it means **five sign-in requests per minute for every physician in the world, combined** — the sixth person to try to log in that minute gets a 429. Fifty practices and a Monday morning is enough. There is a one-time `logger.warn` when this happens (`:347-355`), which is easy to miss in a container log.

**`advanced.ipAddress.trustedProxies` must be set explicitly and verified against the actual deployed proxy chain.** This is a configuration item on the same footing as `storeToken: "hashed"`, not tuning. And it is a mild argument for `storage: "database"`: a shared bucket in a table is at least inspectable after the fact.

### 2.6 The finding that changes the architecture: `auth.api.*` is not rate limited

The limiter is invoked in exactly one place. `grep` across all packages at the tag returns three hits: the definition, its import, and one call site — `packages/better-auth/src/api/index.ts:297-313`, inside the router's `onRequest` hook:

```ts
async onRequest(req) {
    ...
    const rateLimitResponse = await onRequestRateLimit(currentRequest, ctx);
    if (rateLimitResponse) {
        return rateLimitResponse;
    }
```

And `auth.api` is not the router. `packages/better-auth/src/auth/base.ts`:

```ts
const { api } = getEndpoints(authContext, options);   // :39
...
const handler = async (request: Request) => {
    ...
    const { handler } = router(handlerCtx, options);  // :107
    return runWithAdapter(handlerCtx.adapter, () => handler(request));
};
return { handler, fetch: handler, api, ... };         // :110-120
```

`getEndpoints` (`api/index.ts:173-...`) assembles the raw endpoint functions. `router` (`:279-...`) wraps that same `api` object in `createRouter` and is where `onRequest` — and therefore the limiter — lives. **Calling `auth.api.signInMagicLink(...)` invokes the endpoint function directly and never enters the router.** No rate limiting is applied. Not a reduced limit; none.

Better Auth documents this correctly, in a callout at `docs/content/docs/concepts/rate-limit.mdx:12-14`:

> Server-side requests made using `auth.api` aren't affected by rate limiting. Rate limits only apply to client-initiated requests.

**This collides head-on with ADR-0004.** That ADR's consequences include *"`better-auth/react` is never installed. The flow runs from a plain `<form method="post">` to a React Router action calling `auth.api.*`, which keeps the login path at zero client JS"* and, separately, *"rate limiting on database storage and enabled in development so it is actually exercised."* As written, **the second is inert given the first.** A React Router action calling `auth.api.signInMagicLink` is unlimited, and the integration test ADR-0004 mandates would pass happily while the door stands open.

This is a decision for [#20](https://github.com/jasonmlarsen/dpcstartuptasks/issues/20), not for this ticket, but the shape of the choice is now fixed and there are only three moves:

1. **Route through `auth.handler(request)`** — the documented React Router integration (a catch-all `app/routes/api.auth.$.ts` returning `auth.handler(request)` from both `loader` and `action`). Gets the limiter, the router-level origin check, and the 429 for free. Costs the "zero client JS via a plain form to our own action" shape that ADR-0004 chose deliberately; the form would post to the catch-all instead. Note this is a *presentation* cost, not a client-JS cost — a plain `<form>` can post to the catch-all too.
2. **Keep `auth.api.*` and build our own limiter** in the action, in front of the call. We control the key, so this is the only option that gets a **per-address** limit — the thing §2.5 says the library cannot give us at all. Costs: it is security code we own, in the subsystem ADR-0004 explicitly did not want to own security code in.
3. **Both** — handler for the transport-level per-IP limit, our own per-address counter in `sendMagicLink`. Most likely correct, and the only one that covers both axes.

Two mechanical notes if `auth.api.*` stays:

- The **router-level** `originCheckMiddleware` (`api/index.ts:288-292`) is also bypassed, for the same reason. But the magic-link endpoints' own middlewares are declared in their `use:` arrays — `formCsrfMiddleware` on sign-in (`plugins/magic-link/index.ts:212`) and the three `originCheck`s on verify (`:303-319`) — and those are part of the endpoint, so **they still run** on a direct `auth.api` call. ADR-0004's claim that form CSRF and callback-origin checks come for free survives; only the rate limit and the global origin check do not.
- Both endpoints set `requireHeaders: true` (`:211`, `:320`), so a direct `auth.api.*` call must be passed `{ headers: request.headers }` or it throws.

### 2.7 What we would have to build

| Capability | 1.7.5 |
|---|---|
| Rate limiting shipped | yes |
| On by default | **production only**; off in dev |
| Applies to `auth.api.*` | **no — router only** |
| Store | memory (default), database, secondary-storage, custom |
| In-memory viable for one container + SQLite | **yes**, resets on redeploy |
| Configurable window / max | yes, globally, per-plugin, per-path via `customRules` |
| Per-IP | yes — `${ip}\|${path}` |
| Per-address / per-email | **absent entirely** |
| Correct IP behind a multi-hop proxy | **only with `advanced.ipAddress.trustedProxies` set** |

---

## 3. Address enumeration

### 3.1 The sign-in endpoint does not branch on the address at all

The whole handler, `plugins/magic-link/index.ts:238-281`, in order: read `email` and `metadata` from the body; generate a token; hash it if configured; `createVerificationValue`; build the URL; `await options.sendMagicLink(...)`; `return ctx.json({ status: true })`.

**There is no `findUserByEmail`. There is no conditional. There is no early return.** An unknown address takes exactly the same code path as a known one, writes exactly the same row, and gets exactly the same `200 { "status": true }`.

- **Status: identical.** One `return` statement, one shape, declared in the OpenAPI metadata at `:218-234`.
- **Body: identical.** `{ status: true }`.
- **Timing: identical on the server side.** The only work whose duration could vary is `sendMagicLink`, and the handler passes it no information about whether the user exists — because it does not know either.

The user is created lazily at *verify* time (`:400-434`), long after the response has been sent.

**So there is no "setting that forces a uniform response", because there is no non-uniform response to suppress.** This confirms the claim carried from [#7](https://github.com/jasonmlarsen/dpcstartuptasks/issues/7) and relied on by ADR-0004, now read at the tag rather than inferred.

### 3.2 The one library-side way to break it, already pinned shut

`disableSignUp: true` moves the branch to verify time (`:404-433`): an unknown address redirects with `?error=new_user_signup_disabled` rather than creating a user. That is a genuine signal — but reaching it requires holding a valid token, which requires access to the target mailbox, so it is a weak oracle against someone else's address. ADR-0004 already pins `disableSignUp: false`. **Keep it.** If a future ticket wants invite-only signup, it must be enforced somewhere other than this flag, or the flag's leak must be accepted knowingly.

### 3.3 Better Auth's "Email Enumeration Protection" is a different feature. Do not reach for it

`docs/content/docs/reference/security.mdx:310-314` and `docs/content/docs/authentication/email-password.mdx:230-232` describe a named feature — activated by `requireEmailVerification` or `autoSignIn: false`, with `customSyntheticUser` for plugin-added fields — that makes the **sign-up** endpoint return the same `200` for a registered and an unregistered email, with simulated password hashing to flatten timing (`api/routes/sign-up.ts:252`, `:365`).

**That is the email+password sign-up path. It has nothing to do with magic link**, and none of those options affect `/sign-in/magic-link`. A future reader searching the docs for "enumeration" will land here first; this note exists so they do not conclude the magic-link flow needs configuring. It does not.

### 3.4 Rate-limit 429s do not leak either

From §2.5 the key is `${ip}|${path}` — no address component. A 429 on `/sign-in/magic-link` tells an attacker only that *they* have been noisy, never anything about the address they submitted. Good.

### 3.5 The invite flow: nothing to leak, because nothing exists

Three separate facts:

1. **The `magicLink` plugin has no invite concept.** Two endpoints, `/sign-in/magic-link` and `/magic-link/verify` (`plugins/magic-link/index.ts:191-472`). That is all.
2. **The organization plugin is not adopted.** `CONTEXT.md:11` lists "organization" under `_Avoid_`; Practice, Owner, Member and Invite are the app's own vocabulary over the app's own tables, and ADR-0004 names only `magicLink` and `admin`.
3. **The app's invite flow is unbuilt and unspecified.** [#17](https://github.com/jasonmlarsen/dpcstartuptasks/issues/17) is an open prototype ticket that explicitly asks "is it the *same* mechanism, or a second one?"

**So the honest answer is: the invite flow does not leak the same way today, because it does not exist. Its enumeration properties will be entirely determined by #17, and they are not inherited from Better Auth.**

For reference, if the organization plugin were ever adopted: `/organization/invite-member` sits behind `orgSessionMiddleware` and so is not an unauthenticated oracle (`plugins/organization/routes/crud-invites.ts:137-142`), but it does return distinct `USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION` and `USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION` errors (`:345`, `:359`). That is the shape to avoid copying.

The concrete risk #17 should carry is not the library's: **an Owner types a colleague's address, and the screen says something that reveals whether that address already belongs to another Practice.** "Already a member", "already invited", "that address can't be invited" and a plain success are four different answers to a question the Owner is not entitled to ask. The decision — is an invite the same magic link, and what does the Owner see back — is #17's, and this ticket has no library constraint to impose on it.

### 3.6 What we would have to build

| Capability | 1.7.5 |
|---|---|
| Uniform status for known/unknown | **yes, structurally — no branch exists** |
| Uniform body | **yes** |
| Uniform server-side timing | **yes** |
| Setting to force uniformity | **unnecessary; none exists for this path** |
| `disableSignUp: true` reintroduces a leak | yes, at verify time only; already pinned `false` |
| Invite flow leak | **n/a — no invite flow in the library or the app** |
| Risk from *our* pre-checks in front of the endpoint | **ours entirely** |

---

## 4. Consequences for the ADR and for #20

Nothing here overturns ADR-0004's choice of Better Auth. Three of its recorded consequences need amendment, and one gap is now named:

1. **"Rate limiting on database storage and enabled in development so it is actually exercised" is inert as written**, because the same ADR routes the flow through `auth.api.*`, which the router — and therefore the limiter — never sees (§2.6). This needs an explicit decision, not a setting.
2. **`advanced.ipAddress.trustedProxies` belongs in the ADR's "non-default settings that are part of this decision" list.** Unset behind a multi-hop proxy, the app gets one shared global bucket of 5 requests per minute on its only login path (§2.5).
3. **`expiresIn: 600` is right for email latency and does nothing for prefetch** (§1.3). The ADR should not leave the impression that the TTL is the prefetch mitigation.
4. **Per-address rate limiting and any "your link was already used" affordance are net-new code we own** (§2.5, §1.4). The library provides neither and cannot be configured into providing either.

Open questions this ticket deliberately does not answer, all of which are [#20](https://github.com/jasonmlarsen/dpcstartuptasks/issues/20)'s:

- Handler route vs. `auth.api.*` vs. both (§2.6 lays out the three moves).
- Whether to build the interstitial, and if not, what the burned-link screen says given that a re-click is indistinguishable from a forgery (§1.4).
- Whether a burned link auto-reissues, and whether reissue is itself an enumeration or spam vector.
- Where the per-address counter lives, and whether it is durable across redeploys.

---

## 5. Verification notes

- Source read from a local clone of `better-auth/better-auth` at tag `v1.7.5`, commit `5468e6bfcdff799848537cf5ad06ebab15aad9dd` (committed 2026-09-14), the same commit [#12](https://github.com/jasonmlarsen/dpcstartuptasks/issues/12) recorded. Docs quoted are the `docs/content/docs/` tree *in that same commit*, so docs-vs-source disagreements are genuine self-contradictions at one version, not version skew.
- The `@better-auth/utils` CSPRNG claim (§1.3) is the one fact not verifiable in the tagged tree — the package is a separate repository. It was verified from the published tarball of `0.4.2`, the version the workspace catalog pins (`pnpm-workspace.yaml:67`).
- **Not tested, only read.** No running instance was stood up. In particular the timing claim in §3.1 is an argument from the code path (there is no branch), not a measurement. It is a strong argument — you cannot leak timing on a lookup you never perform — but it is not a benchmark. **[UNVERIFIED]** by measurement.
- **Not investigated:** whether any real-world mail scanner actually issues `GET` (as opposed to `HEAD`) against this endpoint in practice, and at what rate. That is an empirical question about mail infrastructure, not about Better Auth, and #20 may want it answered before deciding how much to spend on an interstitial.
