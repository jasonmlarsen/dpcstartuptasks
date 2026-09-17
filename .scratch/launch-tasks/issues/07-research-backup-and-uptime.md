# Research: SQLite backup and uptime monitoring for a Coolify VPS

Type: research
Status: resolved
Blocked by: —
Map: ../map.md

## Question

The database is a file on a VPS, and after the CSV is archived it holds the *only* copy of the global task content as well as every practice's progress. It must be continuously replicated somewhere else, and the owner must be told when the app goes down. Establish the facts:

1. **SQLite replication options** as of now: Litestream (current maintenance status, and its relationship to LiteFS and to Turso/libSQL), Coolify's own volume backup feature, plain `sqlite3 .backup` on a cron, and any newer option. For each: continuous vs. snapshot, recovery procedure and realistic RPO, and whether it works with `better-sqlite3` and WAL mode.
2. **Where do backups go?** S3-compatible object storage options and rough cost at this scale (a database measured in megabytes).
3. **Restore.** The actual steps to bring the app back from a destroyed VPS, and how that restore gets *tested* rather than assumed.
4. **Uptime monitoring.** External monitors that alert on downtime — free or cheap tiers, what they check (HTTP, keyword, TLS expiry), and how they notify (email, SMS, push). Include self-hosted options (Uptime Kuma) and note the flaw in self-hosting a monitor on the same homelab that hosts the thing being monitored.
5. **What Coolify already provides** for health checks, restarts, and notifications — so we do not add a tool that duplicates it.

## Notes for the session

Call the `research` skill. Primary sources only. Write findings to `.scratch/launch-tasks/research/backup-and-uptime.md`. End with a concrete recommended setup and the specific manual steps the owner will need to perform.

## Answer

Full findings, with source URLs for every claim: [`../research/backup-and-uptime.md`](../research/backup-and-uptime.md)

**Litestream is actively maintained** — verified against the GitHub API, not assumed. Repo not archived, last push 2026-09-14, latest release v0.5.17 on 2026-08-31, official Docker image rebuilt the same day. Any account of it as dormant is out of date.

**Recommended setup, four layers:**

1. **Continuous replication:** Litestream v0.5 as a sidecar container beside the Node app, sharing a local named Docker volume, replicating to **Backblaze B2**. RPO ~1 second (Litestream's documented async window). No application code change — Litestream is driver-agnostic and works with `better-sqlite3` in WAL mode. Cost at a few MB: effectively **$0** — B2's first 10 GB is free and Class A/B/C API calls are free, so the 1s sync cadence carries no billing risk. (Cloudflare R2 is an equally good alternative, but Litestream's writes are Class A ops there, so raise `sync-interval` to 5–10s if chosen.)
2. **Daily cold copy:** a `VACUUM INTO` snapshot to a *second provider and account*, as the defence Litestream cannot provide — faithful replication of a corrupted database, or a lost B2 credential.
3. **External uptime monitoring:** **UptimeRobot free tier** (50 monitors, 5-min interval, HTTP + keyword + SSL expiry + domain expiry, email alerts). Use a keyword monitor on a `/health` endpoint that only succeeds after a real database read, so it distinguishes "container up" from "app works."
4. **Replication liveness:** a **Healthchecks.io** free-tier dead-man's-switch pinged hourly only when the newest LTX file is fresh. Litestream silently stopping is invisible to every other layer and is the failure that turns an incident into permanent data loss.

**Ruled out:** LiteFS (clustering, not backup — FUSE + consensus for no benefit on one VPS). Turso/libSQL (a driver swap and a vendor dependency wearing a backup strategy's clothes). **Coolify's database backup feature — it does not support SQLite at all**, only Postgres/MySQL/MariaDB/Mongo/ClickHouse.

**Self-hosted Uptime Kuma is rejected for v1** on the failure-domain argument: a monitor on the VPS it watches cannot report the VPS dying. Power loss, disk-full, kernel panic, network drop, or provider suspension take out monitor and app together, and the result is not a false negative — it is silence, which reads as "everything is fine." Same objection to a homelab box, plus false alarms from residential ISP flaps that train the operator to ignore alerts.

**What Coolify already covers, so we do not duplicate it:** container health checks (Traefik pulls unhealthy containers from routing), and notifications across email/Discord/Telegram/Slack/Pushover/webhook for container-stopped, server-unreachable, disk-usage, deployment and backup events. Coolify's own docs state its monitoring has **no public endpoint checks from outside your infrastructure** — that gap is precisely and only what UptimeRobot fills. Coolify's storage-mount backup can serve as layer 2, but note it cannot restore from the dashboard and needs a container stop for a consistent tar.

**Restore is specified and must be rehearsed.** The research doc contains a 9-step disaster-recovery runbook for a destroyed VPS (restore happens automatically on first boot via `litestream restore -if-db-not-exists` in the entrypoint) and a ~10-minute monthly drill run on the owner's laptop — deliberately not on the server — that proves the bucket alone is sufficient. The newest row's timestamp in the drill copy is the real measured RPO. A second Healthchecks check nags if a month passes without a drill. Coolify's own docs put it well: a successful backup "only proves that Coolify created a file."

**Manual steps for the owner** (~1 hour one-time, then monthly): §7 of the research doc lists all of them — B2 bucket + bucket-scoped application key stored off the VPS, Coolify env vars and health check and notification channels, three UptimeRobot monitors with a deliberately-triggered test alert, and two Healthchecks checks.

**Flagged as unverified** (§8 of the doc): Hetzner Object Storage's exact price, UptimeRobot's free SMS/voice credit allowance, Better Stack's free-tier check frequency, Coolify's notification polling interval and auto-restart behaviour, Turso pricing, the status of rqlite/dqlite/Marmot/cr-sqlite, whether B2 Object Lock conflicts with Litestream's retention deletion, and the R2 worst-case operation-count estimate (my arithmetic, not a Cloudflare statement).
