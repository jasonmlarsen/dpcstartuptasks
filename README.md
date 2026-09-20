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

### Configuration

`APP_URL`, `AUTH_SECRET` and `TRUSTED_PROXIES` are **required in production**,
and the app refuses to start without them rather than warning — sign-in is the
only way in, so each one is a locked door rather than a degraded experience.
In development all three have defaults and nothing needs setting.

| Variable | What it is |
| --- | --- |
| `APP_URL` | Where the app answers, and what a Sign-in Link is addressed to. |
| `AUTH_SECRET` | What session cookies are signed with. Changing it signs everyone out. |
| `TRUSTED_PROXIES` | The reverse proxies in front of the app, as IPs or CIDR ranges, comma-separated. Unset behind a proxy, no client IP can be derived at all and the per-IP limit on Continue has to refuse every press. Behind Coolify this is the Traefik container's address on the app's Docker network — find it with `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' coolify-proxy`. Use the proxy's own address, not a broad private range that would also cover a client. |
| `KIT_API_KEY` | The Kit v4 API key, sent as `X-Kit-Api-Key`. Read only by the sync worker and the provisioning script, never by the app. |

`KIT_API_KEY` is the one credential that is **not** asserted at boot
([ADR-0008](./docs/adr/0008-the-kit-api-key-is-an-environment-variable.md)).
Kit is a newsletter and never the product, so a container without it starts and
serves normally; what refuses is the drain below, and the queue holds until
somebody sets it.

`/health` is the uptime monitor's endpoint. It answers `LAUNCH_TASKS_OK` — the
keyword UptimeRobot watches for — and it can only answer it by reading that
string out of a real row in a real SQLite file. A database that cannot be
opened, never migrated, or errors on read gets a `503` with no keyword in it.

## Kit sync

Consented addresses reach Kit through a queue drained by a worker, so a Kit
outage never delays or fails a physician's registration. **No loader and no
action calls Kit** — a request only ever writes a `kit_sync_job` row.

```sh
npm run kit:provision                              # once per Kit account
npm run kit:drain                                  # the worker, on a schedule
npm run kit:drain -- --database /data/launch-tasks.sqlite
```

`kit:provision` creates the `practice_state` custom field and is idempotent:
it lists the account's fields first and writes nothing if ours is there. Run
it **before the first drain**. Kit does not refuse a write to a field key it
does not know — it answers `201`, drops the key, and puts a line in a
`warnings` array, which the worker treats as a permanent failure.

Both **run from a checkout against the volume's file**, not from inside the
container — the production image carries neither `scripts/` nor `tsx`, and the
drain is an operator act on a schedule (a cron entry on the VPS) in the same
way seeding is an operator act by hand. A drain that never runs costs a
newsletter sync and nothing a physician can see.

The admin panel's System page reports the queue: how many are waiting, how
long the oldest has been there, and how many were suppressed or dead-lettered.
Suppressed is not a failure — it is a Cancelled address, and Cancelled is a
hard wall the app never writes through.

## Seeding the Task Library

```sh
npm run db:seed                                    # the default database
npm run db:seed -- --database /data/launch-tasks.sqlite
```

The Seed Script loads the 98 Tasks and 11 Phases of
[`docs/seed/task-library.csv`](./docs/seed/README.md) into an empty database,
all Published. There is no flag for the CSV: a Seed loads the committed Task
Library or it does not run.

It **can only ever add** — no delete path, no update path — and it refuses
outright when `global_task` already has rows. It knows only about Phases,
Tasks and Helpful Links, so it cannot create a Practice, a User or a
Membership. Together those are what make it safe to point at a production
database.

**It runs from a checkout, never from inside the container.** The script is
deliberately not in the production image: the dangerous capability lives
outside the running app, where no bug can make it reachable. On the VPS that
means a clone, `npm install`, and `--database` pointed at the Coolify
volume's file — the same shape as every other operator act here. Promoting an
Admin is a SQL statement typed on the VPS, and discarding a database is `rm
data/launch-tasks.sqlite`, typed on purpose. There is no screen for any of it.

## Signing in

There is no password. A physician types an address, gets the same *check your
email* page whatever they typed, and the email carries a link to a **Continue
Screen** whose `GET` does nothing at all — corporate mail scanners open links
before their owner does, and only pressing Continue spends the link. The whole
path is plain forms at zero client JS.

Better Auth lives entirely behind [`app/auth/server.ts`](./app/auth/server.ts),
and nothing else in the app imports it. That module is the exit, not tidiness:
see [ADR-0004](./docs/adr/0004-better-auth-behind-one-module.md).

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
