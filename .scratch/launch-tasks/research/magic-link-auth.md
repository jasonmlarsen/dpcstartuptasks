# Research: Magic-link auth in React Router v7 — library or hand-rolled?

Ticket: `../issues/06-research-magic-link-auth.md`
Researched: 2026-09-16
Sources: official docs and first-party repos only. Every non-obvious claim is cited inline. Anything not verified from a primary source is marked **[UNVERIFIED]**.

---

## TL;DR

**Use Better Auth with its `magicLink` plugin, the Drizzle adapter on SQLite, driven from React Router `action`s via `auth.api.*` rather than the client SDK, with Resend as the `sendMagicLink` transport.**

The trade-off this accepts: a fast-moving, pre-2.0 dependency at the centre of the one system you cannot easily swap later. Better Auth shipped `1.7.5` on 2026-09-14 and is running two parallel release lines (`1.6.33` and `1.7.5` published within six minutes of each other) with 718 open issues. You are buying correctness-by-default in exchange for an upgrade treadmill on your auth layer.

---

## 0. Standing context that shifted during this research

**React Router v8 is out and v7 is now in security-maintenance.** npm `react-router@latest` is `8.4.0`, published 2026-09-15; `react-router@version-7` is `7.18.4`, published the same day (npm registry metadata for `react-router`). Per the release post, v8 is a **non-breaking** upgrade from v7, moves the floor to Node 22.22+, React 19.2.7+, Vite 7+, is ESM-only, and drops the `react-router-dom` mirror package. v6 and Remix v2 are EOL; **v7 continues to receive security updates only**.
- https://remix.run/blog/react-router-v8
- https://reactrouter.com/upgrading/v7

This does not change the auth answer — the loader/action model is unchanged — but the effort's map pins "React Router v7" and that should be revisited. `reactrouter.com` now serves v8 docs at the bare paths; v7 docs are under `https://reactrouter.com/v7/...`.

---

## 1. The candidates and their current state

All repo/registry figures below were read directly from the GitHub API and the npm registry on 2026-09-16.

| | Better Auth | Auth.js (NextAuth) | Lucia | remix-auth (+ TOTP) | Clerk / WorkOS |
|---|---|---|---|---|---|
| Latest release | `1.7.5`, 2026-09-14 | `next-auth@4.24.15` + `@auth/core@0.41.3`, both 2026-07-20; **v5 still `5.0.0-beta.32`** | **deprecated Mar 2025** | `remix-auth@4.2.0`, 2025-04-13 | hosted SaaS |
| Last commit | 2026-09-16 | 2026-07-22 | 2026-08-08 (gitignore only) | 2026-09-14 (dependabot) | n/a |
| Open issues | 718 | 604 | 24 | 4 | n/a |
| Magic link first-class | **yes** (`magicLink` plugin) | yes (Email/Resend provider) | n/a (library gone) | via `remix-auth-totp@4.0.0`, last publish 2025-01-24 | yes (Magic Auth) |
| Drizzle + SQLite adapter | **yes** | yes (`@auth/drizzle-adapter@1.11.3`) | n/a | you write it | n/a |
| React Router v7 framework-mode support | **documented** | **no first-party package** | n/a | native | SDKs exist, service is remote |
| Self-hostable, no external service | **yes** | yes | yes | yes | **no** |

### Better Auth
- Magic link is a first-class plugin: `magicLink({ sendMagicLink })`. Options and defaults, read from source (`packages/better-auth/src/plugins/magic-link/index.ts`): `expiresIn` default `60 * 5` (5 min); built-in `rateLimit` default `{ window: 60, max: 5 }`; `generateToken` default `generateRandomString(32, "a-z", "A-Z")`; `storeToken` default `"plain"` with `"hashed"` and `{ type: "custom-hasher" }` available; `disableSignUp` default `false`.
  - https://github.com/better-auth/better-auth/blob/main/packages/better-auth/src/plugins/magic-link/index.ts
  - https://www.better-auth.com/docs/plugins/magic-link
- **Single use is atomic.** Verification calls `internalAdapter.consumeVerificationValue(storedToken)` and redirects with `INVALID_TOKEN` if it returns nothing. The `allowedAttempts` option is explicitly deprecated in source with the note that "each magic link token is consumed atomically on the first verification call, so a given token mints at most one session regardless of this value." (same file)
- **CSRF is built in.** `POST /sign-in/magic-link` runs `formCsrfMiddleware`; `GET /magic-link/verify` runs `originCheck` on every callback URL parameter, so `callbackURL` cannot be pointed off-origin. (same file)
- **Email enumeration is closed by default.** `/sign-in/magic-link` always returns `{ status: true }` regardless of whether the email exists; the user is created lazily at verify time when `disableSignUp` is false. Setting `disableSignUp: true` would reintroduce an enumeration signal at verify time. (same file)
- **React Router v7 integration is documented**, as a catch-all resource route `app/routes/api.auth.$.ts` exporting `loader`/`action` that both return `auth.handler(request)`. The page covers v7 and legacy Remix v2. **[UNVERIFIED]** whether v8 is explicitly supported; nothing in the docs mentions it yet.
  - https://www.better-auth.com/docs/integrations/react-router
- **The client SDK is not required.** Every endpoint has a server twin: source documents `auth.api.signInMagicLink` and `auth.api.magicLinkVerify` alongside the `authClient.*` methods, and the server API docs describe calling them with `{ body, headers, query }` plus `returnHeaders` / `asResponse` to get the `Set-Cookie` back.
  - https://www.better-auth.com/docs/concepts/api
- **Drizzle + SQLite** is supported; `provider` accepts `"sqlite" | "pg" | "mysql"`, with better-sqlite3 named. Schema comes from `npx @better-auth/cli generate`, then `drizzle-kit generate` / `drizzle-kit migrate`.
  - https://www.better-auth.com/docs/adapters/drizzle
- **Rate limiting is framework-level, not just magic-link-level:** default 60s / 100 req in production, **disabled in development by default**, memory storage by default with database or custom `consume` storage available, and stricter per-path rules (e.g. sign-in/email at 3 per 10s).
  - https://github.com/better-auth/better-auth/blob/main/docs/content/docs/concepts/rate-limit.mdx
- Peer dependency floor: `drizzle-orm@^0.45.2 || >=1.0.0-rc.1 <2.0.0`, `drizzle-kit >=0.31.4`, React 18 or 19. Runtime deps include `jose`, `kysely`, `@noble/hashes`, `nanostores`, `@better-fetch/fetch` (npm registry, `better-auth@1.7.5`).
- **[UNVERIFIED]** actual client-bundle size. I did not measure it, and I found no first-party published figure. Since the flow can be driven entirely by a plain `<form method="post">` to the handler route plus server-side `auth.api.*`, the honest position is "zero client JS if you never import `better-auth/react`" — but that is an architectural claim, not a measured one.

### Auth.js / NextAuth
- Magic link works via the Email providers (Resend, Nodemailer, Postmark, …) and **requires a database adapter**: "a database is required for passwordless login to work as verification tokens need to be stored." Default link lifetime is **24 hours**.
  - https://authjs.dev/getting-started/authentication/email
- **There is no first-party React Router or Remix package.** The framework nav lists Next.js, Qwik, SvelteKit, and Express (Express marked "not documented yet"). Using it here means wiring `@auth/core` by hand — i.e. hand-rolling the integration layer, which is the part you were hoping to buy.
- **v5 has been in beta for years and is still in beta.** `next-auth@beta` is `5.0.0-beta.32`, published 2026-07-20; the stable `latest` is `4.24.15`, which is Next.js-only. The repo's last commit on the default branch was 2026-07-22 — roughly two months of no activity. (npm registry `next-auth`; GitHub API `nextauthjs/next-auth`)
- 24h default expiry is long for a credential that is a bearer token in an inbox; Better Auth's 5-minute default is the safer posture.

**Verdict: ruled out.** No React Router story, stable line is Next-only, v5 has no ship date.

### Lucia
- **Confirmed deprecated.** Repo README, verbatim: *"Lucia was deprecated on March 2025. See code/auth_session.ts for a complete, single-file replacement for the NPM package."* It also points at the Auth Book.
  - https://github.com/lucia-auth/lucia (README)
  - Announcement: https://pilcrowonpaper.com/blog/18
  - Auth Book: https://auth.pilcrowonpaper.com
- The repo now contains exactly two files of substance: `LICENSE` and `code/auth_session.ts` (6,137 bytes, ~190 lines). It is a **session** implementation only — not a magic-link implementation, not a user store, no email. The author's recommendation is "copy this file and read the book," not "use this other library."

**Verdict: not an option as a library.** It *is* the best primary reference for the hand-rolled path (see §3).

### remix-auth
- Native to Remix/React Router and genuinely lightweight, but it is a **strategy shell**, not an auth system: no user store, no token storage, no rate limiting. Magic link would come from `remix-auth-totp`, last published `4.0.0` on **2025-01-24** — ~20 months stale. The core `remix-auth@4.2.0` last published 2025-04-13; repo commits since are dependabot bumps.

**Verdict: ruled out** on the strength of the magic-link strategy's staleness, not the core.

### Clerk / WorkOS
- **Clerk has no self-hosting path.** Its architecture docs describe a Clerk-provisioned Frontend API instance (`https://<slug>.clerk.accounts.dev`, CNAME'd to your domain in production) plus a Clerk-run Backend API. Nothing in the docs describes running it on your own infrastructure.
  - https://clerk.com/docs/guides/how-clerk-works/overview
- **WorkOS AuthKit** supports Magic Auth (one-time codes, 10-minute expiry) and its free tier covers the first 1M MAU, but it is a hosted service; I found no self-hosting option documented.
  - https://workos.com/docs/authkit/magic-auth
  - https://workos.com/pricing

**Verdict: ruled out by the map's constraint** ("self-hosted on a VPS, no external auth service dependency preferred"). For ~50 practices, both would also mean introducing a third-party outage surface in front of the only door into the app. Note this constraint is a *preference*, so it is the one you could revisit if Better Auth's churn becomes intolerable.

---

## 2. What React Router gives you natively

React Router ships the session layer, and only the session layer.

- `createCookieSessionStorage({ cookie })` stores all session data in a signed cookie. Cookie options include `secrets: string[]`, `httpOnly`, `secure`, `sameSite`, `maxAge`, `domain`, `path`. It returns `getSession()`, `commitSession()`, `destroySession()`. Limit: serialized data must fit in the browser's max cookie size, and all data lives client-side.
  - https://reactrouter.com/v7/api/utils/createCookieSessionStorage
- Also available: `createSessionStorage()` (custom DB-backed — you supply `createData`/`readData`/`updateData`/`deleteData`), `createMemorySessionStorage()`, `createFileSessionStorage()` (from `@react-router/node`), plus Cloudflare KV and Architect variants.
  - https://reactrouter.com/v7/explanation/sessions-and-cookies
- **Secret rotation is supported**: prepend the new secret to `secrets`; old cookies still verify, new ones are signed with the first entry.
- The docs' one explicit security instruction: *"It's important that you logout (or perform any mutation for that matter) in an `action` and not a `loader`. Otherwise you open your users to Cross-Site Request Forgery attacks."* React Router does **not** ship CSRF token machinery — that discipline is on you.

**How much of an auth system is this?** It is the session half, done properly, and nothing else. It gives you a signed, `httpOnly`, rotatable cookie. It gives you **zero** of: user/account tables, token issue-and-consume, expiry, single-use, rate limiting, enumeration handling, or email. Roughly, it's the last 20% of the work, already done.

Important: `createCookieSessionStorage` is a *stateless* session. There is no server-side record, so **there is no way to revoke a session before it expires** — no "sign out all devices," no instant kill after a member is removed from a practice. Given the map's "Owner can remove Members," that matters. A DB-backed session (Better Auth's default, or `createSessionStorage`) does not have that hole.

---

## 3. The hand-rolled path — what "correct" actually costs

The best primary reference is the Lucia author's post-deprecation material, since it is the same author who concluded the library layer wasn't worth maintaining.

From `code/auth_session.ts` (https://github.com/lucia-auth/lucia/blob/main/code/auth_session.ts), verbatim design points:
- Session record: `id`, `user_id`, `secret_hash` (BLOB), `token_last_verified_at`, `created_at`. A SQLite `STRICT` DDL is given inline.
- Token = `id + "." + secret.toBase64()` where secret is **32 cryptographically-random bytes** from `crypto.getRandomValues`, stored as a **SHA-256 hash**, never in plaintext.
- Cookie attributes prescribed: `Path=/`, `Expires`, `Secure`, `HttpOnly`, `SameSite=Lax`.
- Sessions valid 10 days, sliding — re-verification extends expiry.
- File header, in caps: *"CSRF PROTECTION MUST BE IMPLEMENTED IF THE SESSION TOKEN IS STORED IN A COOKIE."* Suggested minimum: reject non-`GET`/`HEAD` requests unless `Sec-Fetch-Site === "same-origin"`, and reject when the header is absent.
- Note that `Uint8Array.toBase64()` requires Node 25+ — you would need a polyfill on Node 22/24.

That file is **~190 lines and covers sessions only.** On top of it, a magic-link flow still needs:
1. Request endpoint: normalize email, issue a high-entropy token, **store only its hash**, set a short expiry (5–15 min), send via Resend.
2. Verify endpoint: hash the presented token, look it up, check expiry, **delete-and-return atomically** (a `DELETE ... RETURNING` in SQLite, inside a transaction) so a double-click or a race cannot mint two sessions.
3. Rate limiting on *both* per-email and per-IP axes, persisted (in-memory dies on container restart, and Coolify redeploys restart the container).
4. **Constant response on request**: always reply "check your email," never "no such account" — otherwise the login form is an email-enumeration oracle. This is listed in the map's own "Not yet specified" section.
5. Account creation / invite acceptance branching, since Account = Practice with an Owner and up to 2 Members.
6. Session revocation on member removal.

Realistic size: the session file (~190 lines) + magic-link issue/verify (~150–250) + rate limiting (~80–150) + schema and tests. **Call it 500–700 lines you own forever**, plus the security judgement to keep owning it. That is not unreasonable for a solo operator — it is genuinely doable — but every one of those lines is a place to be wrong once and not find out.

### Known footguns (apply to *any* implementation, library or not)
- **Storing the token in plaintext.** Note Better Auth's `storeToken` defaults to `"plain"` — a DB read or backup leak hands an attacker live login links. **Set `storeToken: "hashed"`.** This is the single most important configuration line in the recommendation. (source: plugin source, §1)
- **GET-consumes-token.** The verify endpoint is a `GET` that consumes the token on first hit — true for Better Auth (`GET /magic-link/verify` → `consumeVerificationValue`) and for essentially every magic-link design. Corporate mail scanners, link-safety prefetchers, and some mobile mail clients follow links before the human does, burning the token and producing "your link has expired" for a user who never clicked. Mitigation is an interstitial "Click to sign in" page that POSTs, or a short-lived re-issue on `INVALID_TOKEN`. **[UNVERIFIED]** — I found no first-party Better Auth documentation acknowledging this or offering a built-in interstitial; this is inferred from the endpoint's method and semantics in source. **Treat as an open design question for the implementation ticket.**
- **Long expiry.** Auth.js's 24h default is a live credential sitting in an inbox for a day. Better Auth's 5-minute default is better; 10–15 minutes is a reasonable humane compromise given email latency.
- **Open redirect via `callbackURL`.** Better Auth guards this with `originCheck` on all three callback params. A hand-rolled version must do the same explicitly.
- **Rate limiting in memory.** Better Auth's default rate-limit storage is memory and is **off in development** — so the thing you most want to test is the thing that is disabled locally. Configure database storage.
- **Enumeration.** Constant-response on request; also watch timing (a real send is slower than a no-op) — queue the send or always do equivalent work.

---

## 4. Resend (the sending side)

- Current SDK: `resend` on npm, `latest` = **`6.28.1`**, published 2026-09-15; repo `resend/resend-node` last commit 2026-09-15 — actively maintained. (npm registry; GitHub API)
- API: `new Resend(process.env.RESEND_API_KEY)` then `resend.emails.send({ from, to, subject, html })`. The SDK returns `{ data, error }` rather than throwing — **you must check `error` explicitly**; an unchecked call fails silently and the user just never gets the link.
  - https://resend.com/docs/send-with-nodejs
- `idempotencyKey` is supported on send, unique per request, expires after 24h. Useful if the magic-link action can be retried.
- **Deliverability, the important part: leave click tracking OFF.** Resend's docs state open and click tracking are **disabled by default for all domains**, and that with click tracking on, links are rewritten to route through a tracking subdomain before redirecting. Their own recommendation: *"We suggest only tracking open rates for Broadcasts to ensure that inbox providers do not mistakenly identify your transactional emails as marketing emails."*
  - https://resend.com/docs/dashboard/domains/tracking
  - Practical consequence for this app: a rewritten magic link is a redirect chain through a third-party host on a single-use credential — worse spam scoring, and an extra hop that can burn the token. Verify tracking is off on `mail.directcaretools.com` (relates to ticket 09).
- React Email is supported via `react: Component({...})` (called as a function, not JSX). Optional — plain `html` is fine and keeps the dependency count down, which matches the map's "fewer moving parts."
- **[UNVERIFIED]** I found no Resend documentation specifically about deliverability of *short-lived login links* as a category. The concrete, citable guidance is the tracking recommendation above; the rest (dedicated subdomain, SPF/DKIM/DMARC) is generic and already settled in the map.

---

## 5. Recommendation

**Better Auth `1.7.x` + `magicLink` plugin + Drizzle/SQLite adapter, driven server-side from React Router actions. Resend for transport.**

Specifically:
- Catch-all resource route `app/routes/api.auth.$.ts` → `auth.handler(request)` for both `loader` and `action` (per the React Router integration doc).
- **Do not install `better-auth/react`.** Drive the request flow from a normal React Router `action` calling `auth.api.signInMagicLink({ body, headers })`, posted from a plain `<form>`. This keeps the login path at zero client JS, satisfying the map's "do not ship client JS that isn't earning its place."
- **`storeToken: "hashed"`.** Non-negotiable; the default is plaintext.
- `expiresIn: 600` (10 min) rather than the 5-minute default, to survive email latency without leaving a long-lived credential in an inbox.
- Leave `disableSignUp: false` so the request endpoint stays enumeration-safe.
- Configure rate limiting with **database storage**, and enable it in development so it is actually exercised.
- Resend: check `{ error }` on every send; keep click/open tracking off on the sending domain.

### Why not hand-rolled
The hand-rolled path is genuinely viable here — the author of the deprecated library literally publishes the file you'd start from, and 500–700 lines is not a lot. But the map's own standing preference is "prefer fewer moving parts over more capability… the owner is a solo operator working with agents." Hand-rolled auth is *fewer dependencies* but *more moving parts that you maintain*, and it is the one subsystem where a subtle agent-written bug is silent, security-relevant, and discovered by an attacker rather than a test. Better Auth gets atomic single-use, origin checks, form CSRF, enumeration safety, and rate limiting correct by default, with a real Drizzle/SQLite adapter and a documented React Router integration. Nothing else on the list clears all four constraints at once.

### The trade-off this accepts, stated plainly
**You are taking on a pre-2.0, high-velocity dependency in the position that is hardest to reverse.** Better Auth published `1.6.33` and `1.7.5` on the same day and carries 718 open issues; there is no LTS line and no stated support policy I could find. **[UNVERIFIED]** — I found no published Better Auth version-support or deprecation policy. Concretely, budget for: reading release notes on every minor upgrade, pinning an exact version in `package.json`, and an integration test that actually exercises request → email → verify → session so an upgrade that changes token or cookie behaviour fails loudly in CI rather than quietly in production.

The mitigation that makes this reversible: **keep every Better Auth call behind one module** (e.g. `app/auth/server.ts` exporting `requestMagicLink`, `verifyMagicLink`, `getSession`, `signOut`). If Better Auth goes the way of Lucia, you replace that module with `code/auth_session.ts` plus ~300 lines, and nothing else in the app knows.

---

## 6. Open items for the implementation ticket

1. **The GET-prefetch problem** (mail scanners consuming tokens). Unaddressed by any source I found. Decide on an interstitial POST page vs. accepting the failure mode.
2. **React Router v7 vs v8.** v7 is security-updates-only as of the v8 release; the upgrade is documented as non-breaking. Worth a map-level decision before implementation starts.
3. **Session revocation on member removal** — confirm Better Auth's session model supports it (it uses DB-backed sessions, so it should; not verified against the session-management docs in this pass). **[UNVERIFIED]**
4. **Better Auth v8 compatibility** — the integration doc names v7 and Remix v2 only. **[UNVERIFIED]**
5. Verify click/open tracking is disabled on `mail.directcaretools.com` (ticket 09).

---

## Sources

- https://www.better-auth.com/docs/plugins/magic-link
- https://github.com/better-auth/better-auth/blob/main/packages/better-auth/src/plugins/magic-link/index.ts
- https://www.better-auth.com/docs/integrations/react-router
- https://www.better-auth.com/docs/adapters/drizzle
- https://www.better-auth.com/docs/concepts/api
- https://github.com/better-auth/better-auth/blob/main/docs/content/docs/concepts/rate-limit.mdx
- https://authjs.dev/getting-started/authentication/email
- https://github.com/lucia-auth/lucia
- https://github.com/lucia-auth/lucia/blob/main/code/auth_session.ts
- https://pilcrowonpaper.com/blog/18
- https://auth.pilcrowonpaper.com
- https://github.com/sergiodxa/remix-auth
- https://clerk.com/docs/guides/how-clerk-works/overview
- https://workos.com/docs/authkit/magic-auth
- https://workos.com/pricing
- https://reactrouter.com/v7/api/utils/createCookieSessionStorage
- https://reactrouter.com/v7/explanation/sessions-and-cookies
- https://remix.run/blog/react-router-v8
- https://reactrouter.com/upgrading/v7
- https://resend.com/docs/send-with-nodejs
- https://resend.com/docs/dashboard/domains/tracking
- npm registry metadata (`better-auth`, `next-auth`, `@auth/core`, `@auth/drizzle-adapter`, `remix-auth`, `remix-auth-totp`, `resend`, `react-router`), read 2026-09-16
- GitHub API repo/commit/release metadata for the repos above, read 2026-09-16
