# Research: magic-link auth in React Router v7 — library or hand-rolled?

Type: research
Status: resolved
Blocked by: —
Map: ../map.md

## Question

Auth is the one piece this stack does not give us, and the choice is hard to reverse. Establish the facts:

1. **What are the current, maintained options** for passwordless magic-link auth in a React Router v7 (SSR, framework mode) app on Node with SQLite/Drizzle? Better Auth, Auth.js, Clerk/WorkOS (hosted), or hand-rolled. Note that Lucia was deprecated — confirm its current status and what its author recommends instead.
2. **For each candidate:** does it support magic link as a first-class flow, does it have a Drizzle + SQLite adapter, does it work with React Router v7's loader/action model (as opposed to assuming Next.js), how much client JS does it ship, and is it self-hostable with no external service?
3. **Session handling.** Cookie-based sessions in React Router v7 — what does the framework provide natively (`createCookieSessionStorage`) and how much of an auth system is that already?
4. **The hand-rolled path.** What does a correct magic-link implementation actually require: token generation and hashing, single-use enforcement, expiry, rate limiting, and the email-enumeration concern. Roughly how much code, and what are the known footguns?
5. **Resend integration** for the sending side — current SDK, and anything specific about deliverability of short-lived login links.

Constraints that rule options in or out: self-hosted on a VPS, no external auth service dependency preferred, minimal client JS, ~50 practices.

## Notes for the session

Call the `research` skill. Primary sources only — official docs and repos, not blog summaries. Write findings to `.scratch/launch-tasks/research/magic-link-auth.md` and end with a clear recommendation and the trade-off it accepts.

## Answer

**Better Auth (`1.7.x`) with its `magicLink` plugin + Drizzle/SQLite adapter, driven server-side from React Router actions, with Resend as the transport.**

- **Lucia is confirmed dead** — deprecated March 2025; the author's replacement is a single ~190-line `code/auth_session.ts` (sessions only, no magic link) plus the Auth Book.
- **Auth.js is ruled out**: no first-party React Router/Remix package (Next.js, Qwik, SvelteKit, Express only), v5 still `5.0.0-beta.32`, 24h default link expiry.
- **Clerk / WorkOS are ruled out** by the self-hosted, no-external-auth-service constraint.
- **remix-auth is ruled out** because the magic-link piece (`remix-auth-totp`) last published 2025-01-24.
- **React Router natively gives you the session half only** (`createCookieSessionStorage` and friends) — signed, httpOnly, rotatable cookies, no user store, no tokens, no rate limiting, and no revocation for the stateless cookie variant.
- **Hand-rolling is viable but costs ~500–700 lines you own forever**, with real footguns: plaintext token storage, non-atomic consumption, enumeration on the request endpoint, CSRF, open redirect via callback URL.
- **Required config**: `storeToken: "hashed"` (the default is `"plain"`), `expiresIn: 600`, `disableSignUp: false`, database-backed rate limiting. Do not import `better-auth/react` — use `auth.api.signInMagicLink` from an action so the login path ships zero client JS.
- **Resend**: SDK `6.28.1`, returns `{ data, error }` (check it), and keep click/open tracking **off** on the sending domain — Resend itself recommends this for transactional mail, and rewritten links are bad news for single-use credentials.

**Trade-off accepted:** a pre-2.0, fast-moving dependency (718 open issues, two parallel release lines) in the least-reversible position in the app. Mitigation: pin the exact version, keep all Better Auth calls behind one `app/auth/server.ts` module, and add an integration test covering request → verify → session.

**Flagged during research:** React Router **v8** shipped and v7 is now security-updates-only; the upgrade is documented as non-breaking. The map pins v7 and should revisit. Also unresolved: mail scanners/prefetchers consuming the `GET /magic-link/verify` token before the human clicks.

Full findings, comparison table, and source citations: [`../research/magic-link-auth.md`](../research/magic-link-auth.md)
