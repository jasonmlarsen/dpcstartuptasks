---
status: accepted
---

# The Kit API key is an environment variable, and a missing one stops the worker rather than the app

The Kit v4 API key lives in **`KIT_API_KEY`**, set on the host beside `APP_URL`, `AUTH_SECRET` and `TRUSTED_PROXIES`, read through `kitApiKey()` in `app/services/kit-http-client.ts`, and never committed to this repo.

Unlike those three, it is **not asserted at boot**. A container with no Kit key starts, serves, registers physicians and sends Sign-in Links exactly as it always did. What refuses is `npm run kit:drain`, which exits non-zero having done nothing, leaving every queued Kit Sync Job queued.

This is the "settle at build time" item [#41](https://github.com/jasonmlarsen/dpcstartuptasks/issues/41) carried out of research: where the key lives, and what a missing one costs.

## Why

**An environment variable is what the deployment already is.** The app is one container on one VPS behind Coolify, whose environment panel is where the other three secrets are typed. A secrets manager would be a second system to run for one string, and a file mounted into the container would be a second thing to back up and a second way to lose it. There is no third environment and no per-tenant key: one product, one Kit account, one key.

**Not asserting at boot is the whole point of the queue.** `app/auth/config.ts` refuses to start without its three because sign-in is the only way into the product — a misconfigured door is a locked one, and failing loudly at boot beats failing per request. Kit is the opposite case in every respect: it is a newsletter, nobody is waiting on it, and no loader or action may call it at all. A boot assertion would convert a missing newsletter key into total downtime, which is a worse outcome than the thing it would be protecting against.

**The queue is already the backstop.** A job that cannot run is not a job that is lost. Jobs accumulate with `outcome IS NULL`, the admin panel's System page shows the oldest one waiting, and a drain after the key is set catches up. So the cost of the key being missing is bounded and visible, which is what makes not asserting it safe rather than merely convenient.

## Considered and rejected

- **Assert at boot alongside the other three.** Rejected: it makes a newsletter credential able to take down a physician's task list, and the product deliberately has no path where Kit can do that.
- **A key file mounted into the container.** Rejected: nothing else in this deployment reads a secret from disk, and it adds a file to the backup story for no gain.
- **A row in the database.** Rejected: it would put a live credential in the daily cold backup, which is the thing the scrub script exists to stop, and it would make rotation a SQL statement rather than a restart.
- **Failing the drain silently when the key is absent.** Rejected: a worker that exits zero having done nothing is invisible in a scheduler's log, which is precisely where an operator would look for it.

## Consequences

- **Rotating the key is an environment edit and a restart of the scheduled drain.** No migration, no deploy of code.
- **`KIT_API_KEY` belongs in the deployment checklist, not in the boot assertion.** A production instance that has never had one works correctly in every respect a physician can observe, and its queue grows until somebody looks at the System page.
- **The custom field is provisioned separately** by `npm run kit:provision`, which uses the same key and is idempotent. The field must pre-exist before any job drains: Kit answers a write to an unknown field key with `201` and a warning, which the worker treats as a permanent failure.
- **Tests never need the key.** No test makes real HTTP; seam 2 hands the worker a `FakeKitClient`, and the production client is only ever built by the drain command.
