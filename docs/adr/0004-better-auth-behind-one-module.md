---
status: accepted
---

# Better Auth, behind one module

Authentication is **Better Auth** — the `magicLink` plugin on the Drizzle/SQLite adapter, driven server-side from React Router actions, with Resend as the transport. The version is **pinned exactly**, not floated on a caret.

Every call into it lives behind a single module, `app/auth/server.ts`. Nothing else in the application imports `better-auth`.

## Why

Magic link is the only door into this product. There is no password to fall back on, so a subtle bug in this layer is not a degraded experience — it is either a locked-out physician or an open front door, and nothing in between.

Better Auth gets the things that are easy to get wrong right *by default*: single-use tokens consumed atomically, so a token mints at most one session; origin checks on every callback URL, so the redirect cannot be pointed off-site; form CSRF on the request endpoint; and an enumeration-safe response that returns success whether or not the email exists. Those four are exactly the properties that a hand-rolled implementation passes its own tests while quietly lacking.

It is also the only candidate that clears all four of this project's constraints at once — self-hosted, a real Drizzle/SQLite adapter, a documented React Router integration, and a maintained magic-link path. Every rejection below is a failure of one of those four, not a matter of taste.

**The single module is not tidiness; it is the exit.** This decision knowingly puts a pre-2.0 dependency in the position that is hardest to reverse, and the module is what makes the position reversible anyway: if Better Auth goes the way of Lucia, the replacement is that one file rewritten against a session implementation plus a few hundred lines, and no route, loader or component learns that anything changed.

## Considered and rejected

- **Hand-rolling it.** Genuinely viable — Lucia's author publishes the single file you would start from, and 500–700 lines is not a lot. Rejected because the standing preference is *fewer moving parts*, and hand-rolled auth is fewer dependencies but more parts **we** maintain. This is the one subsystem where an agent-written bug is silent, security-relevant, and found by an attacker rather than by a test.
- **Auth.js / NextAuth.** No first-party React Router package at all, so adopting it means hand-wiring the integration layer — precisely the part we were trying to buy. The stable line is Next.js-only; v5 has been in beta for years with no ship date. Its 24-hour default link lifetime is also far too long for a bearer credential sitting in an inbox.
- **Lucia.** Deprecated by its own author, who now recommends copying one session file and reading a book. It is a session implementation, not an auth system: no user store, no magic link, no email. It remains the best reference for the escape hatch above, which is the role it plays here.
- **remix-auth.** Native to the framework and pleasantly small, but a strategy shell rather than an auth system, and its magic-link strategy is roughly twenty months stale.
- **Clerk / WorkOS.** Both ruled out by self-hosting. Both would also put a third-party outage surface directly in front of the only door into the app, for ~50 practices. This is the softest rejection of the five — it rests on a preference rather than a hard requirement, so it is the one to revisit if Better Auth's churn ever becomes intolerable.

## Consequences

- **An upgrade treadmill on the auth layer, deliberately accepted.** Better Auth is pre-2.0 with no LTS line and no published support policy, running parallel release lines (`1.6.33` and `1.7.5` were published six minutes apart). Budget for reading release notes on every minor bump.
- **An integration test exercising request → email → verify → session is mandatory**, not optional coverage. It is what makes an upgrade that changes token or cookie behaviour fail loudly in CI instead of quietly in production. It is doubly required because of the revocation call below.
- **`session.cookieCache` must never be enabled.** Turned on, `/get-session` is served from a signed cookie with zero database reads, and a revoked session stays alive for its `maxAge` — five minutes by default. It is off by default and has to stay off, because an Owner removing a Member is an access-control action that must take effect. **Better Auth's own documentation contradicts itself here**: one callout warns correctly, while the same page claims a paragraph earlier that revocation invalidates the cookie automatically. That sentence is false as of `1.7.5`, and it is the sentence a future reader would find if they went looking for permission to turn the cache on.
- **`revokeSession({ token })` must never be used to end another user's session.** Handed a token belonging to someone else it skips the delete and still returns `{ status: true }` — a silent no-op reporting success. All the public core endpoints are self-scoped; the correct call is `auth.$context` → `internalAdapter.deleteUserSessions(userId)`, which is typed and exported but absent from the documented API pages. That semi-public status is the reason the integration test above is non-negotiable.
- **"Immediately" means "on the next request."** Auth resolves once at the top of a request, so an in-flight SSR document completes with full authority after revocation. The cost is one more page view. Membership removal should therefore run the delete and the revocation in one transaction, and revoke first if it cannot be atomic, because that order fails safe.
- **Non-default settings that are part of this decision, not tuning:** `storeToken: "hashed"` (the default stores tokens in plaintext), `expiresIn: 600` to survive email latency without leaving a long-lived credential in an inbox, `disableSignUp: false` so the request endpoint stays enumeration-safe, and rate limiting on database storage and enabled in development so it is actually exercised.
- **⚠ Contested: the rate-limiting consequence above is currently inert.** Better Auth's limiter is invoked only in the router's request handler, and its own documentation states that *"server-side requests made using `auth.api` aren't affected by rate limiting."* Combined with the next consequence — the flow posting to a React Router action calling `auth.api.*` — this ADR as written leaves **no rate limiting on the only door into the app**. Surfaced by [issue #19](https://github.com/jasonmlarsen/dpcstartuptasks/issues/19); [issue #20](https://github.com/jasonmlarsen/dpcstartuptasks/issues/20) decides the fix and this ADR should be amended by its outcome. Do not implement auth against this ADR until it resolves.

- **`better-auth/react` is never installed.** The flow runs from a plain `<form method="post">` to a React Router action calling `auth.api.*`, which keeps the login path at zero client JS.
- **React Router v8 compatibility is unverified.** The integration documentation names v7 and Remix v2 only. The loader/action model is unchanged and v8 is documented as a non-breaking upgrade, so this is expected to be a non-event — but it is expectation, not evidence, and it should be settled early in implementation rather than discovered.

Choice and alternatives: [issue #7](https://github.com/jasonmlarsen/dpcstartuptasks/issues/7). Revocation findings: [issue #12](https://github.com/jasonmlarsen/dpcstartuptasks/issues/12).
