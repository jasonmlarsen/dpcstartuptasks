# Launch Tasks

A free, multi-tenant web app that walks a physician through starting a Direct
Primary Care practice as a task list.

Read [`CONTEXT.md`](./CONTEXT.md) first — the vocabulary is load-bearing, and
this repo uses it strictly. Decisions live in [`docs/adr/`](./docs/adr/); where a
ticket and an ADR disagree, the ADR wins.

## Stack

TypeScript, React Router v8 (SSR, framework mode), Drizzle over SQLite
(`better-sqlite3`), Tailwind 4, shadcn/ui selectively, Vitest. Deployed as a
single Docker container with the SQLite file on a volume. See
[ADR-0005](./docs/adr/0005-typescript-react-router-sqlite-over-rails.md).

## Running it

```sh
npm install
npm run dev          # http://localhost:3000
npm run typecheck
npm test
npm run build
```

`DATABASE_PATH` selects the SQLite file, defaulting to
`./data/launch-tasks.sqlite`. Migrations run when the database is opened, so
there is no separate setup step; `npm run db:generate` writes a new one after a
schema change.

`/health` is the uptime monitor's endpoint. It answers `LAUNCH_TASKS_OK` — the
keyword UptimeRobot watches for — and it can only answer it by reading that
string out of a real row in a real SQLite file. A database that cannot be
opened, never migrated, or errors on read gets a `503` with no keyword in it.

## Styling

[`styles/design-tokens.css`](./styles/design-tokens.css) is the source of truth
for colour and spacing. It is the parent site's file, and `app/app.css` imports
it *after* Tailwind and shadcn so that it overrides both. shadcn/ui is installed
but pulled in only where accessibility is genuinely hard — dialog, dropdown,
date picker, toast. Everything else is plain markup, and no client JS ships
unless it is earning its place.

## Testing

**Four seams, and no fifth.** Read
[`docs/agents/testing.md`](./docs/agents/testing.md) before writing a test; it is
the house style and the only description of it. The default is `createTestApp()`
in [`test/harness.ts`](./test/harness.ts).
