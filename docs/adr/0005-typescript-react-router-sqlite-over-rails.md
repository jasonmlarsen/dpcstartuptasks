---
status: accepted
---

# TypeScript, React Router and SQLite, over Rails

The stack is **TypeScript + React Router v8** (SSR, framework mode) + **Drizzle** + **SQLite** (`better-sqlite3`) + **Tailwind 4** + **shadcn/ui, selectively** + **Vitest**, deployed to the owner's own VPS through Coolify as a **single Docker container with the SQLite file on a volume**.

It follows the conventions of the owner's reference repo (`ai-hero-dev/ai-coding-crash-course`).

The alternative seriously considered, and rejected, was **Rails 8**.

## Why

Three reasons, in the order they actually decided it.

**The owner reads this stack.** This is a solo operator working with agents, and the binding constraint on the whole project is not how fast code gets written — agents write it either way — but whether a human can review what was written and say yes or no to it. A stack the owner cannot read turns every review into trust. That argument outranks every technical comparison below, and it is the one that would still hold if all the others reversed.

**A React Native path stays open.** A mobile app is explicitly out of scope for this effort, but it is plausible later, and sharing a language and a mental model with a future React Native client costs nothing today. Rails would have closed that door, or at least made it a second codebase in a second language.

**The batteries Rails brings were not wanted.** Rails' strongest argument here is the admin panel — ActiveAdmin and friends would have produced one nearly free. But the admin surface was scoped deliberately narrow: three flat sections, no bulk edit, no revision table. A generated admin panel would have been *more* than was wanted, in a shape that resists being made less.

**SQLite, specifically**, because the expectation is roughly 50 Practices within six months and fewer in year one. That is four orders of magnitude inside SQLite's comfort zone. A separate database service would add a container, a connection pool, a backup story and a failure mode, in exchange for headroom that will not be reached. One file on a volume is the whole persistence layer.

## Considered and rejected

- **Rails 8.** The genuine alternative, and stronger than this stack on two axes: authentication and background jobs both arrive in the box, and the admin panel would have been close to free. Rejected on the three reasons above, with the first one — readability by the person reviewing it — doing most of the work. This rejection deserves to be re-read honestly if the hand-assembled parts below become a drag.
- **A client/server database (Postgres or MySQL).** Rejected on scale: at ~50 Practices and ~4,900 Task Entries, it buys headroom that will not be used and costs a second service to run, monitor and back up. The cost is real and named in the consequences — this is the choice that makes horizontal scaling unavailable.
- **Blanket shadcn/ui.** Rejected in favour of pulling components in **only where accessibility is genuinely hard** — dialog, dropdown, date picker, toast. Plain markup everywhere else. The standing preference is to ship no client JS that is not earning its place, and a component library adopted by default quietly earns nothing on a page that is mostly text and checkboxes.
- **React Router v7.** Not so much rejected as corrected: the target was initially recorded as v7, but v8 shipped on 2026-09-15 with v7 moving to security updates only, and the upgrade is documented as non-breaking. v8 is the target.

## Consequences

- **Authentication is assembled by hand, and is the largest single consequence of this ADR.** Rails would have supplied it; here it became a research ticket, a library choice with a pre-2.0 dependency in the least reversible position, and its own ADR. See [ADR-0004](./0004-better-auth-behind-one-module.md). If this ADR is ever revisited, that is the first cost to weigh.
- **Background work is assembled by hand too.** The Kit sync runs through a queue table drained by a worker, written from scratch, because there is no Active Job equivalent in the box.
- **Backups are a decision rather than a checkbox**, and the obvious button is the wrong one: Coolify's database-backup feature does not support SQLite. The answer is a Litestream sidecar replicating to object storage, a daily cold copy to a second provider, and a dead-man's-switch on replication liveness — four moving parts that a managed Postgres would have replaced with one.
- **The app scales vertically only.** One container holding one SQLite file cannot be run as two replicas, and writes serialise. At the expected size this is irrelevant; it is also the constraint that would bite hardest and earliest if the product grew unexpectedly, and it is not a small change to undo.
- **Expect an ecosystem upgrade every 12–18 months**, touching the framework, the build tool and the Node floor together. v8 alone moves the floor to Node 22.22+, React 19.2.7+ and Vite 7+, and is ESM-only. This is the ongoing tax the Rails alternative would have charged more slowly.
- **The admin panel is hand-built**, which was the point, but it means every admin capability is a decision and a feature rather than a generated default.
- **Visual identity comes from the parent site's `styles/design-tokens.css`**, which remains the source of truth for colour and spacing regardless of what Tailwind or shadcn would default to.

Settled during the charting conversation, before any ticket existed; recorded here because the map is not a durable record. Context: [issue #1](https://github.com/jasonmlarsen/dpcstartuptasks/issues/1).
