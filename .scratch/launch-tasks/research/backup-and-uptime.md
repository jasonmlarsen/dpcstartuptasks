# Research: SQLite backup and uptime monitoring for a Coolify VPS

Resolves: [`../issues/07-research-backup-and-uptime.md`](../issues/07-research-backup-and-uptime.md)
Researched: 2026-09-16. Primary sources only (official docs, GitHub API, first-party pricing pages).

**Context assumed throughout:** one self-hosted VPS running Coolify, one Node container,
one SQLite file of a few megabytes, ~50 tenant practices, `better-sqlite3` in WAL mode,
solo non-sysadmin operator who values few moving parts.

---

## 0. Bottom line up front

| Concern | Answer |
|---|---|
| Replication | **Litestream v0.5.x**, run as a sidecar container next to the app. Actively maintained; last release 2026-08-31. |
| Destination | **Backblaze B2** (S3-compatible). At a few MB the bill is effectively $0 — first 10 GB free, and Class A/B/C API calls are free. |
| RPO | ~1 second (Litestream's default sync interval), with the honest caveat that replication is asynchronous. |
| Restore | `litestream restore` against the bucket; must be **rehearsed on a schedule**, not assumed. |
| Uptime alerting | **UptimeRobot free tier** (external, 50 monitors, 5-min HTTP + keyword checks) plus Coolify's own notification channel. |
| Do NOT | Self-host Uptime Kuma on the VPS it is meant to watch. Do not use Coolify's database backup feature (it does not support SQLite). |

---

## 1. SQLite replication options

### 1.1 Litestream — maintenance status (verified, not assumed)

The ticket flags this specifically, so it was checked against the GitHub API rather than
recalled.

- Repository `benbjohnson/litestream`: **not archived**, last push **2026-09-14**,
  14,382 stars, 145 open issues.
  Source: <https://api.github.com/repos/benbjohnson/litestream>
- Recent releases: **v0.5.17 (2026-08-31)**, v0.5.16 (2026-08-05). Both stable, not prereleases.
  Source: <https://api.github.com/repos/benbjohnson/litestream/releases>
- The official site labels v0.5.x "Latest — Actively maintained with new features and bug fixes,"
  with v0.3.14 retained as the previous line.
  Source: <https://litestream.io/>
- Official Docker image `litestream/litestream:latest` was last pushed **2026-08-31**
  (amd64 + arm64), matching the v0.5.17 release date.
  Source: <https://hub.docker.com/v2/repositories/litestream/litestream/tags>

**Conclusion: Litestream is currently maintained and actively released.** Any advice you have
read elsewhere describing it as dormant or abandoned reflects an earlier period and is out of
date as of 2026-09-16.

### 1.2 How Litestream works, and why that matters here

- SQLite in WAL mode writes page changes to a `-wal` file before checkpointing them back into
  the main database. Litestream "starts a long-running read transaction to prevent any other
  process from checkpointing and restarting the WAL file," so that **only Litestream
  checkpoints**. Source: <https://litestream.io/how-it-works/>
- v0.5 replaced the old "shadow WAL" scheme with **LTX files** (Litestream Transaction Log),
  each carrying a monotonically incrementing transaction ID (TXID) and per-page checksums,
  staged locally then uploaded and compacted into levels L0–L3 plus level-9 snapshots.
  Source: <https://litestream.io/how-it-works/>
- Restore granularity is **LTX file boundaries**, not individual transactions; partial LTX
  files cannot be applied. Source: <https://litestream.io/how-it-works/>

Documented defaults: sync interval **1s**, snapshot interval **24h**, snapshot retention **24h**,
L0 retention **5m**, monitor interval **1s**, checkpoint interval **1m**.
Source: <https://litestream.io/reference/config/>

> Note on retention: the defaults keep snapshots for 24 hours. For a product where the database
> is the only copy of the global task library, **raise `snapshot.retention` well beyond 24h**
> (see §6). Litestream actively deletes old remote files per the `retention` block as of v0.5.8.
> Source: <https://litestream.io/reference/config/>

Documented caveats that apply directly to this deployment:

- **Asynchronous replication.** "Litestream uses asynchronous replication with a ~1 second
  default window where unreplicated changes could be lost on catastrophic failure." That is the
  realistic RPO. Source: <https://litestream.io/tips/>
- **One replicator per database path.** "Multiple applications replicating into the same bucket
  & path can cause situations where you will be unable to restore." Preventing this is the
  operator's responsibility. Source: <https://litestream.io/tips/>
- **Set a busy timeout.** Apps should set `PRAGMA busy_timeout = 5000;` so writes do not fail
  while Litestream checkpoints. Source: <https://litestream.io/tips/>
- **Litestream enables WAL itself** if the database is not already in WAL mode.
  Source: <https://litestream.io/tips/>
- **Never on a network filesystem.** NFS/SMB/GlusterFS "can cause database corruption." Use a
  local named volume, a bind mount, or attached block storage.
  Source: <https://litestream.io/guides/docker/>
- **Recreating a database** requires deleting the `.db`, `-wal`, and `-shm` files *and* running
  `litestream reset`. Source: <https://litestream.io/tips/>

### 1.3 Does Litestream work with `better-sqlite3` and WAL?

Yes, and there is nothing driver-specific about it. Litestream operates on the database *file*
via the SQLite file format and WAL, as a separate process — "it integrates into existing
applications without requiring code modifications." Source: <https://litestream.io/>

On the app side, `better-sqlite3` supports exactly the two pragmas Litestream asks for:

- Busy timeout: the `new Database()` constructor takes `options.timeout` — "the number of
  milliseconds to wait when executing queries on a locked database, before throwing a
  SQLITE_BUSY error (default: 5000)."
- WAL mode: settable via `db.pragma('journal_mode = WAL')`.

Source: <https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md>

`better-sqlite3` is itself actively maintained — v13.0.3 released 2026-08-05, and v13.0.0
(2026-07-21) was the first N-API build, which makes prebuilt binaries portable across Node
versions. Source: <https://api.github.com/repos/WiseLibs/better-sqlite3/releases>

**One caution:** `better-sqlite3` is synchronous and holds the database file open in the same
container. That is fine — the app and Litestream are separate processes sharing one file, which
is the documented design. What must not happen is two *Litestream* processes on the same path.

### 1.4 LiteFS — not appropriate here

- `superfly/litefs`: **not archived**, last push **2026-05-11**, 4,876 stars, 62 open issues.
  Source: <https://api.github.com/repos/superfly/litefs>
- It is a "FUSE-based file system for replicating SQLite databases across a cluster of machines."
  Same source.

LiteFS solves *multi-node clustering* (primary/replica across machines), not *offsite backup*.
It requires a FUSE mount inside the container and a consensus/lease mechanism. For one VPS and
one container it adds a kernel-level moving part that buys nothing. **Rejected on the
"fewer moving parts" standing preference.** Litestream and LiteFS are separate projects by
overlapping authors (Ben Johnson wrote Litestream; LiteFS is under the Fly.io org).

### 1.5 Turso / libSQL — not appropriate here

Turso today positions itself as a SQLite-compatible next-generation engine, "fully backwards
compatible with SQLite," offering an embedded database engine plus **Turso Cloud**, a managed
platform for "Turso and libSQL databases," with branching and backups, and a **Turso Sync**
hybrid mode for local reads/writes with push/pull to the cloud.
Source: <https://docs.turso.tech/introduction>

Why not here: adopting Turso means swapping `better-sqlite3` for a libSQL client, taking a
dependency on a hosted vendor, and changing a stack decision that the map records as settled.
It is a database migration wearing a backup strategy's clothes. Litestream leaves the stack
untouched.

> **Unverified:** I did not audit Turso Cloud's current free-tier limits or pricing, since the
> option was ruled out on architecture grounds. If it is ever reconsidered, check
> <https://turso.tech/pricing> directly.

### 1.6 Coolify's built-in backup features

There are two distinct Coolify features, and the more obvious one does not apply.

**Database backups (does not apply).** Coolify provides "scheduled, engine-aware database
backups for PostgreSQL, MySQL, MariaDB, MongoDB, and ClickHouse," with cron or
hourly/daily/weekly schedules, local retention, and optional upload to an S3-compatible
destination with independent retention. **SQLite is not among the supported engines.**
Source: <https://coolify.io/docs/databases/backups>

**Storage-mount backups (applies, but as a secondary belt).** Coolify can create scheduled
`.tar.gz` archives of an application's volume mounts and directory mounts, and push copies to
S3-compatible storage, optionally deleting the local archive after upload. Retention has three
independent limits per location (count — default 7, days, and GB).
Source: <https://coolify.io/docs/core/persistent-storage/storage-mounts/backups>

Two critical properties of that feature:

1. **Consistency requires stopping the container.** Coolify lets you choose whether to stop
   containers during archiving; disabling the stop "risks file inconsistency," enabling it
   "causes temporary application unavailability." Same source. Tarring a live SQLite file
   without stopping the writer can capture a torn `.db`/`-wal` pair.
2. **Coolify does not restore.** "Coolify does not restore storage archives from this page" —
   the dashboard only creates and manages archives. Same source.

So: snapshot, not continuous; RPO equals the schedule interval (hours); restore is fully manual.
Useful as a second, independent copy — **not** as the primary strategy.

Coolify's own docs make the point the ticket cares about: "a successful backup only proves that
Coolify created a file." Source: <https://coolify.io/docs/databases/backups>

### 1.7 `sqlite3 .backup` / `VACUUM INTO` on a cron

The modern form of this is `VACUUM INTO`, which SQLite documents as "an alternative to the
backup API for generating backup copies of a live database." It produces a fully vacuumed copy
without modifying the original, and is safe against a live database.
Source: <https://www.sqlite.org/lang_vacuum.html>

Caveats from the same page:

- The target file must not already exist (or must be empty), otherwise the command errors.
- If interrupted by power loss, "the generated output database might be incomplete and corrupt"
  — **unless** `PRAGMA synchronous` is NORMAL or FULL on the source, in which case SQLite
  fsyncs the output.

Assessment: correct, dependency-free, and easy to reason about — but snapshot-only. RPO equals
the cron interval, and a nightly cron means up to 24 hours of lost practice progress. It also
requires the operator to hand-roll upload, rotation, and failure alerting, which is *more*
moving parts than Litestream, not fewer. **Best role: a cheap daily "cold copy" second tier,
not the primary.**

### 1.8 Newer / other options considered

- **Turso Sync / Turso Cloud** — see §1.5. Rejected: stack change.
- **LiteFS** — see §1.4. Rejected: wrong problem.
- **Litestream's VFS extension and `restore -f` (follow mode)** — v0.5 can maintain a
  continuously-updating read-only replica, and ships a read-only VFS for reading directly from
  object storage. Sources: <https://litestream.io/reference/restore/>,
  <https://litestream.io/reference/>. Interesting for a future warm standby; not needed for v1.
- **rqlite / dqlite / Marmot / cr-sqlite** — distributed or CRDT SQLite systems. Not
  investigated in depth: all replace the storage engine or add a cluster, which contradicts the
  map's "prefer fewer moving parts." **Flagged as unverified** — no primary-source check was
  performed on their current status.

### 1.9 Comparison table

| Option | Continuous? | Realistic RPO | Works with better-sqlite3 + WAL | Restore | Moving parts |
|---|---|---|---|---|---|
| **Litestream v0.5** | Yes | ~1s (async) | Yes, unchanged app code | `litestream restore` one command | +1 sidecar container, +1 config file |
| Coolify storage-mount backup | No (cron) | = schedule (hours) | Yes, but consistency needs container stop | Manual untar | Zero new tools (in-dashboard) |
| `VACUUM INTO` on cron | No (cron) | = schedule (hours) | Yes | Copy file into place | Custom script + upload + rotation |
| Coolify DB backup | N/A | N/A | **No — SQLite unsupported** | N/A | N/A |
| LiteFS | Yes (cluster) | near-zero | Yes, via FUSE mount | Failover | FUSE + consensus |
| Turso Cloud / Sync | Yes | vendor-defined | **No — driver swap** | Vendor console | Vendor dependency |

---

## 2. Where do backups go? S3-compatible storage at a few megabytes

All figures from first-party pricing pages, checked 2026-09-16.

### Backblaze B2 — recommended

- Storage: **$6.95 / TB / month** (≈ $0.00695/GB/month). **First 10 GB always free.**
- Egress: free up to **3× average monthly storage**; $0.01/GB beyond; unlimited free egress via
  partner CDNs (Cloudflare, Fastly, bunny.net).
- API calls: **"Class A, B, and C API calls are free for pay-as-you-go customers. Class D
  transactions cost $0.004 per 10,000 calls plus the first 2,500 calls per day are free."**
- **No minimum file size fees. No minimum storage duration fees.**

Source: <https://www.backblaze.com/cloud-storage/pricing>

Litestream has a documented B2 guide, and **v0.5.0+ auto-detects Backblaze B2 endpoints**, so
`force-path-style` can be omitted. Source: <https://litestream.io/guides/backblaze/>

**Why this wins here:** free Class A/B/C calls mean Litestream's 1-second sync cadence cannot
generate a surprise bill, and a few-MB database with months of LTX history stays inside the
10 GB free allowance. Realistic cost: **$0.00/month.** The absence of minimum retention fees
matters because Litestream constantly deletes expired LTX files.

### Cloudflare R2 — strong alternative

- Standard storage **$0.015/GB-month**; Infrequent Access $0.01/GB-month.
- Class A operations **$4.50/million**; Class B **$0.36/million**.
- **Egress is free** via Workers API, S3 API, and `r2.dev`.
- Free tier (Standard only): **10 GB-month storage, 1M Class A, 10M Class B, free egress.**

Source: <https://developers.cloudflare.com/r2/pricing/>

Caveat unique to R2: Litestream's writes are **Class A** operations. At the 1s default sync
interval, a database written to continuously could in the worst case approach ~86,400 PUTs/day
≈ 2.6M/month, exceeding the 1M free Class A allowance (~$7/month at $4.50/M). In practice a
checklist app for 50 practices is written to in sparse bursts and Litestream only uploads when
there are changes, so this is very unlikely — but if R2 is chosen, raise `sync-interval` to
5–10s to put it comfortably out of reach. **This worst-case arithmetic is my own estimate from
the published rates, not a vendor statement.**

### Hetzner Object Storage — EU option

S3-compatible; locations Falkenstein (FSN1), Helsinki (HEL1), Nuremberg (NBG1). An hourly base
price capped monthly includes **1 TB storage and 1 TB egress**. Ingress, intra-eu-central
traffic, and **S3 API calls (PUT/GET/DELETE) are free**. Limits: 100 buckets, 100 TB/bucket,
50M objects/bucket. Source: <https://www.hetzner.com/storage/object-storage/>

> **Unverified:** the exact monthly euro figure did not render in the fetched page. Historically
> around €6/month for the 1 TB bundle — confirm on the page before budgeting. For a few MB this
> is strictly worse than B2's free tier, since there is a base charge regardless of usage.

### Also supported by Litestream

Litestream v0.5 supports eight replica types: **S3** (any S3-compatible bucket), **GCS**,
**Azure Blob Storage**, **SFTP**, **NATS JetStream**, **Alibaba Cloud OSS**, **WebDAV**, and
**local file**. Source: <https://litestream.io/reference/config/>

The `file` replica type is worth knowing about: it is a free way to keep a second, independent
replica on a different disk or a mounted second volume.

### Recommendation

**Backblaze B2 as the primary replica.** Cost at this scale is zero, API calls are free so the
sync interval carries no cost risk, and there is a first-party Litestream guide with
auto-detected endpoints. R2 is an equally good technical choice if the operator already lives in
Cloudflare; the only difference that matters is the Class A operation accounting.

**Second, independent destination** for the daily cold copy (§6): a *different provider and a
different account* from the primary. A single compromised API key or a single billing lapse
should not be able to take out both copies.

---

## 3. Restore: bringing the app back from a destroyed VPS

### 3.1 What the restore actually is

`litestream restore` "recovers database backup from a replica," either from a database path in
the config file or directly from a replica URL:

```
litestream restore [arguments] DB_PATH
litestream restore [arguments] REPLICA_URL
```

Flags that matter for this scenario (source: <https://litestream.io/reference/restore/>):

| Flag | Use |
|---|---|
| `-o PATH` | Write the restored database somewhere specific |
| `-timestamp TIMESTAMP` | Point-in-time restore |
| `-txid TXID` | Restore to a specific transaction ID |
| `-integrity-check quick\|full` | Validate the restored file |
| `-dry-run` | Print the restore plan without writing |
| `-if-db-not-exists` | Exit 0 if the database already exists — safe in a container entrypoint |
| `-if-replica-exists` | Exit 0 when no backups found — safe on very first boot |
| `-force` | Overwrite an existing non-empty file |
| `-f` | Follow mode: keep applying new transactions (warm standby) |

Restore granularity is limited to LTX file boundaries, and retention can permanently remove
older restore points. Source: <https://litestream.io/how-it-works/>

### 3.2 Full disaster recovery runbook (destroyed VPS)

Assumes the app is deployed as a Docker Compose stack in Coolify with a Litestream sidecar
(§6), and that the operator holds the B2 credentials and the git repo off the VPS.

1. **Provision a new VPS** at the same or a new provider. Install Coolify per
   <https://coolify.io/docs> (single install script on a fresh Ubuntu/Debian host).
2. **Point DNS** for `launchtasks.directcaretools.com` at the new IP. Do this early so the TLS
   certificate can issue while the rest proceeds.
3. **Recreate the Coolify project/application** from the same git repository and the same
   Compose file. Nothing about the app is server-specific.
4. **Re-enter environment variables** from the password manager: the Resend API key, the app's
   session/signing secrets, and `LITESTREAM_ACCESS_KEY_ID` / `LITESTREAM_SECRET_ACCESS_KEY`.
   (See §7 — these must be stored off the VPS *before* the disaster.)
5. **Deploy.** The Litestream sidecar's entrypoint runs
   `litestream restore -if-db-not-exists -if-replica-exists -o /data/app.db s3://...` *before*
   starting replication, so the database is pulled down from B2 automatically on first boot.
   Source pattern: <https://litestream.io/guides/docker/>
6. **Verify integrity** before letting traffic in: run
   `litestream restore -integrity-check full -o /tmp/verify.db s3://...` and confirm it passes,
   and run a `PRAGMA integrity_check;` plus a row count on the restored file.
7. **Confirm replication resumed**: `litestream status` should report the configured database
   replicating, and `litestream ltx` should list recent LTX files with fresh timestamps.
   Source: <https://litestream.io/reference/>
8. **Smoke test the product path**: request a magic link, confirm it arrives via Resend, log in,
   confirm one practice's task states are intact and the global library is present.
9. **Re-point monitoring**: UptimeRobot monitors are URL-based, so if DNS moved they need no
   change; if the domain changed, update them.

Realistic data loss: up to ~1 second of writes, per Litestream's documented async window.
Realistic wall-clock recovery: dominated by VPS provisioning and DNS propagation, not by the
restore — a few-MB database downloads in seconds.

### 3.3 How the restore gets *tested* rather than assumed

This is the part that is normally skipped, and it is the part the ticket specifically asks for.
Coolify's own docs put it bluntly: a successful backup "only proves that Coolify created a file."
Source: <https://coolify.io/docs/databases/backups>

A restore drill that costs about ten minutes, run on a fixed schedule (**recommend: monthly, and
after any change to the Litestream config or the database schema**):

1. On the operator's **laptop**, not the server — the whole point is to prove the bucket alone
   is sufficient. Install Litestream (<https://litestream.io/install/>).
2. Export the B2 credentials into the shell.
3. Run a dry run first, to see the plan without writing:
   `litestream restore -dry-run s3://BUCKET.s3.REGION.backblazeb2.com/db`
4. Restore for real with a full integrity check:
   `litestream restore -integrity-check full -o ./drill.db s3://BUCKET.s3.REGION.backblazeb2.com/db`
5. Open it: `sqlite3 ./drill.db` and run `PRAGMA integrity_check;`, then a count of practices and
   a count of task states, and eyeball the most recently updated row's timestamp. **That
   timestamp is the real RPO measurement** — it should be seconds old, not hours.
6. Test a point-in-time restore too, once, so the flag is familiar before it is needed:
   `litestream restore -timestamp 2026-09-15T12:00:00Z -o ./drill-pit.db s3://...`
7. Delete the drill files. Record the date and the observed RPO somewhere durable.

Automating the drill's *reminder* is worth doing: create a Healthchecks.io check on a monthly
schedule that the operator pings manually only after completing the drill. If a month passes
without a ping, Healthchecks emails a nag. Free tier covers 20 checks
(<https://healthchecks.io/pricing/>).

---

## 4. Uptime monitoring

### 4.1 The requirement

The app going down must reach the owner without the owner looking. That means an **external**
monitor — one that is not on the VPS, not on the owner's home network, and not sharing the
failure domain of the thing it watches.

### 4.2 UptimeRobot — recommended

Free plan, per <https://uptimerobot.com/pricing/>:

- **50 monitors**
- **5-minute check interval**
- Monitor types: **HTTP, keyword, port, ping, API, UDP, DNS, SSL, domain expiry**
- Up to **5 alert integrations** (email, SMS, voice call available)
- 3 months of data retention, 1 basic status page

Cheapest paid tier (Solo) is **$144/year (~$12/month billed annually)** and adds 60-second
intervals, SSL & DNS monitoring, 3 status pages with custom domains, 12-month retention,
3 login seats, and 10–20 SMS/voice credits. Same source.

For this product, the free tier is genuinely sufficient: a checklist app for 50 practices does
not need 60-second detection, and 5 minutes of downtime detection latency is immaterial next to
the time it takes a solo operator to respond.

> **Partially unverified:** the pricing page lists SMS and voice as "available" on free but the
> exact free-tier credit allowance was not stated on that page. Treat **email as the reliable
> free channel** and confirm SMS credits in the dashboard before depending on them.

### 4.3 Better Stack — alternative

Free plan: **10 monitors & heartbeats, 1 status page, unlimited Slack & email alerts**, plus
telemetry allowances (100k exceptions/mo, 3 GB logs at 3-day retention, etc.). Cheapest paid
uptime option is the **Responder license at $29/month billed yearly**.
Source: <https://betterstack.com/uptime/pricing>

Better Stack's incident management (on-call, escalation, phone calls) is genuinely stronger, but
it is built for teams with rotations. A solo operator does not have anyone to escalate to.

> **Unverified:** Better Stack's free-tier *check frequency* was not stated on the fetched
> pricing page. Confirm before choosing it over UptimeRobot on that basis.

### 4.4 Healthchecks.io — for silent failures, not for downtime

Free (Hobbyist) plan: **20 monitored jobs, 100 log entries per job, $0/month**. Paid: Supporter
$5/mo, Business $20/mo (100 jobs, 50 SMS/WhatsApp, 20 phone calls), Business Plus $80/mo.
20% annual discount. Business is free for open-source projects and nonprofits on request.
Source: <https://healthchecks.io/pricing/>

It is also open source and self-hostable: `healthchecks/healthchecks`, BSD 3-Clause,
"open-source cron job and background task monitoring service, written in Python & Django,"
not archived, last push **2026-09-14**, 10,332 stars.
Source: <https://api.github.com/repos/healthchecks/healthchecks>

This is a *different* tool for a *different* failure. UptimeRobot catches "the site is down."
Healthchecks catches "the site is up but something scheduled stopped happening" — most
importantly, **Litestream stopped replicating**. That failure is completely silent to an HTTP
monitor and is exactly the failure that turns a recoverable incident into permanent data loss.
Use the free tier with a dead-man's-switch ping (§6, step 8).

### 4.5 Uptime Kuma — and the flaw in self-hosting it

`louislam/uptime-kuma`: not archived, last push **2026-09-17**, **91,444 stars**, 807 open
issues, "A fancy self-hosted monitoring tool."
Source: <https://api.github.com/repos/louislam/uptime-kuma>

Capabilities are excellent: HTTP(s), HTTP keyword, HTTP JSON-query, TCP, Ping, DNS, Docker,
push/heartbeat, and ~20 other monitor types, with 87+ native notification providers (Telegram,
Discord, Slack, SMTP email, Pushover, ntfy, Gotify, PagerDuty, Opsgenie…) plus Apprise for the
rest.
Sources: <https://github.com/louislam/uptime-kuma>,
<https://github.com/louislam/uptime-kuma/wiki/Notification-Methods>,
<https://github.com/louislam/uptime-kuma/tree/master/server/notification-providers>

**The flaw, stated plainly:** a monitor that shares a failure domain with its target cannot
report that target's failure. If Uptime Kuma runs on the same Coolify VPS as the app, then the
events that most need alerting — the VPS powers off, the disk fills, the kernel panics, the
datacenter drops the network, the provider suspends the account — take out the monitor and the
app *simultaneously*. The result is not a false negative; it is **silence**, which the operator
will read as "everything is fine." The same objection applies to running it on a homelab box
behind a residential connection: a home ISP outage produces a flood of false alarms that trains
the operator to ignore the alerts, and a home power cut produces the same silence.

Self-hosted Uptime Kuma is only sound when it runs somewhere with genuinely independent failure
modes — a second VPS at a *different* provider, a different region, a different network. For a
solo operator that means paying for and patching a second server whose only job is to watch the
first, which is strictly more moving parts and more cost than UptimeRobot's free tier.
**Rejected for v1.** It remains a sensible choice later if a second box already exists for
other reasons.

### 4.6 What to actually monitor

1. **HTTP + keyword** on a real page, not just `/`. A keyword check that looks for a string only
   rendered after a successful database read (e.g. a heading on the landing page, or a small
   `/health` endpoint that returns a known token only after a `SELECT 1` against SQLite)
   distinguishes "the container is up" from "the app works." UptimeRobot's free tier includes
   keyword monitors. Source: <https://uptimerobot.com/pricing/>
2. **TLS/SSL expiry.** Coolify issues certs via Traefik and normally renews automatically, but a
   renewal failure is silent until users see a browser warning. UptimeRobot's free tier lists
   SSL and domain-expiry monitor types. Same source.
3. **Domain expiry.** A lapsed domain registration is a total, self-inflicted outage.
4. **Replication liveness** via a Healthchecks.io dead-man's-switch (§6, step 8).

### 4.7 A note on the health endpoint

Coolify's own guidance for HTTP health checks: add an endpoint such as `/health` that "should
return success only when the process is ready, remain lightweight, and avoid changing
application data." Source: <https://coolify.io/docs/knowledge-base/health-checks>

Build one endpoint and use it for both Coolify's container health check and the external
UptimeRobot monitor. One endpoint, two consumers.

---

## 5. What Coolify already provides (so we do not duplicate it)

| Capability | What Coolify gives | Verdict |
|---|---|---|
| **Container health checks** | HTTP or CMD health checks per application, configured under Configuration → Healthcheck. Provides "a readiness signal for deployments and rolling replacement," and **Traefik removes unhealthy containers from routing**. Source: <https://coolify.io/docs/knowledge-base/health-checks> | **Use it.** Point it at `/health`. No external tool needed for this. |
| **Notifications** | Six channels: **Email** (hosted, SMTP, or Resend API), **Discord**, **Telegram**, **Slack/Mattermost** webhook, **Pushover**, and generic **Webhook**. Events include deployment, backup, scheduled task, container (e.g. stopped), server (e.g. unreachable), and disk usage. Each channel selects events independently. Source: <https://coolify.io/docs/knowledge-base/notifications> | **Use it.** Covers deploy failures, container-stopped, and disk-full — none of which UptimeRobot sees until they cause an outage. |
| **Built-in monitoring** | Server reachability/validation, container state and Docker health, disk checks and CPU/memory metrics, operational events and log forwarding. Source: <https://coolify.io/docs/core/observability/monitoring/overview> | Useful dashboard. Not an alerting system. |
| **Storage-mount backups** | Scheduled `.tar.gz` of volume/directory mounts, local + S3, three retention limits per location, optional container stop for consistency, **no restore from the dashboard**. Source: <https://coolify.io/docs/core/persistent-storage/storage-mounts/backups> | Optional second tier only. |
| **Database backups** | PostgreSQL, MySQL, MariaDB, MongoDB, ClickHouse. Source: <https://coolify.io/docs/databases/backups> | **Not applicable — SQLite unsupported.** |

**The gap Coolify explicitly does not fill.** Its own docs state that built-in monitoring "is not
a complete external observability system," and list among the gaps: **no CPU/memory threshold
alerts** and **no public endpoint checks from outside your infrastructure**, recommending
external tools for advanced alerting. Source:
<https://coolify.io/docs/core/observability/monitoring/overview>

That is the precise justification for adding exactly one external monitor and nothing more.
Coolify watches from the inside; UptimeRobot watches from the outside. There is no overlap worth
deduplicating.

> **Unverified:** Coolify's monitoring/notification polling frequency (how quickly a
> "server unreachable" notification fires) was not stated in the fetched pages. Also unverified:
> whether Coolify auto-restarts a failed container — the docs pages fetched did not address it.
> In practice Docker's own `restart: unless-stopped` policy in the Compose file handles this;
> set it explicitly rather than relying on Coolify's defaults.

---

## 6. Recommended setup

Four layers, in decreasing order of importance. Layers 1 and 3 are non-negotiable; 2 and 4 are
cheap insurance.

**Layer 1 — Continuous replication: Litestream sidecar → Backblaze B2.**
RPO ~1 second. Zero application code change. One extra container.

**Layer 2 — Daily cold copy: a scheduled `VACUUM INTO` pushed to a second provider.**
A single consistent `.db` file per day, on a *different* provider and account. This is the
defence against the failure Litestream cannot protect against: a corrupted or maliciously
truncated database faithfully replicated to B2, or a lost B2 credential. Litestream's own
`type: file` replica to a second mounted volume is an even simpler variant if a second volume
exists. Source for `file` replica type: <https://litestream.io/reference/config/>

**Layer 3 — External uptime monitoring: UptimeRobot free tier.**
HTTP keyword monitor + SSL expiry + domain expiry, email alerts. Five minutes' detection latency.

**Layer 4 — Replication liveness: Healthchecks.io free tier dead-man's-switch.**
Alerts when Litestream *stops*, which is invisible to every other layer.

Plus: Coolify's own health check and notification channels, which are already paid for.

### Configuration sketch

`litestream.yml` (mounted into the sidecar):

```yaml
dbs:
  - path: /data/app.db
    replicas:
      - type: s3
        bucket: launchtasks-db
        path: app
        endpoint: s3.us-west-000.backblazeb2.com   # match your B2 region
        snapshot:
          interval: 6h
          retention: 720h                           # 30 days, not the 24h default
```

Credentials via `LITESTREAM_ACCESS_KEY_ID` / `LITESTREAM_SECRET_ACCESS_KEY` environment
variables. Sources: <https://litestream.io/guides/backblaze/>,
<https://litestream.io/reference/config/>, <https://litestream.io/getting-started/>

Compose sketch (Coolify deploys Compose stacks and creates the bridge network itself — do **not**
declare custom networks, per <https://coolify.io/docs/knowledge-base/docker/compose>):

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    volumes:
      - app-data:/data
    environment:
      DATABASE_URL: /data/app.db
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  litestream:
    image: litestream/litestream:latest
    restart: unless-stopped
    depends_on: [app]
    volumes:
      - app-data:/data
      - ./litestream.yml:/etc/litestream.yml:ro
    environment:
      LITESTREAM_ACCESS_KEY_ID: ${B2_KEY_ID}
      LITESTREAM_SECRET_ACCESS_KEY: ${B2_APP_KEY}
    command: replicate -config /etc/litestream.yml

volumes:
  app-data:
```

The sidecar pattern with a shared **local named volume** is the documented Docker approach:
both containers on the same host, local storage, so file locking coordinates correctly.
Source: <https://litestream.io/guides/docker/>

For first boot on a fresh server the restore must happen *before* the app opens the database.
Either add an init container or make the app container's entrypoint run
`litestream restore -if-db-not-exists -if-replica-exists -o /data/app.db s3://...` first.
Sources: <https://litestream.io/guides/docker/>, <https://litestream.io/reference/restore/>

App-side pragmas, set once at connection time:

```js
const db = new Database('/data/app.db', { timeout: 5000 });
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
```

Sources: <https://litestream.io/tips/>,
<https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md>

> Note: `synchronous = NORMAL` is Litestream's documented recommendation in WAL mode to reduce
> fsync overhead. Be aware it interacts with the `VACUUM INTO` crash-safety caveat in §1.7 —
> NORMAL is sufficient for SQLite to fsync the `VACUUM INTO` output.
> Sources: <https://litestream.io/tips/>, <https://www.sqlite.org/lang_vacuum.html>

---

## 7. Manual steps for the owner

These are the things only a human with credentials can do. Nothing here can be automated by an
agent.

**Backblaze B2 (~15 minutes)**
1. Create a Backblaze account at <https://www.backblaze.com/>. Enable two-factor authentication.
2. Create a **private** bucket, e.g. `launchtasks-db`. Note its region (it appears in the endpoint
   hostname, e.g. `s3.us-west-000.backblazeb2.com`).
3. Enable **Object Lock / file versioning** if offered — it protects against an attacker with the
   API key deleting history. *(Unverified: whether Litestream v0.5's retention deletion
   interacts badly with Object Lock. Test in a throwaway bucket before enabling on the real one.)*
4. Create an **application key scoped to that one bucket** — not a master key. Record the `keyID`
   and `applicationKey`; the secret is shown exactly once.
5. Store both in a password manager, **off the VPS**, in the same entry as the recovery runbook.

**Coolify / deployment (~30 minutes)**
6. Add `B2_KEY_ID` and `B2_APP_KEY` as environment variables on the application in Coolify.
7. Deploy the Compose stack with the Litestream sidecar. Confirm the shared volume is a local
   named volume, not any network filesystem.
8. Verify replication is live: exec into the sidecar and run `litestream status` and
   `litestream ltx`; confirm recent LTX files with fresh timestamps.
   Source: <https://litestream.io/reference/>
9. Configure the application health check in Coolify: Configuration → Healthcheck → HTTP,
   endpoint `/health`. Source: <https://coolify.io/docs/knowledge-base/health-checks>
10. Configure Coolify notifications: Notifications tab → enable **Email** (it can use the Resend
    API, which is already set up for this project) or **Pushover** if a phone push is wanted.
    Enable the container-stopped, server-unreachable, disk-usage, and backup event types.
    Source: <https://coolify.io/docs/knowledge-base/notifications>
11. Optionally enable a Coolify **storage-mount backup** schedule on the app's data volume as
    layer 2, with S3 to a second provider. Decide deliberately whether to let it stop the
    container during archiving — with Litestream already running, a *non*-stopping tar is
    acceptable because it is a redundant tier, not the primary.
    Source: <https://coolify.io/docs/core/persistent-storage/storage-mounts/backups>

**UptimeRobot (~10 minutes)**
12. Create a free account at <https://uptimerobot.com/>.
13. Add an **HTTP(s) keyword** monitor on `https://launchtasks.directcaretools.com/health`
    (or the landing page), matching a string that only appears when the database read succeeds.
    5-minute interval.
14. Add an **SSL expiry** monitor and a **domain expiry** monitor for the same domain.
15. Add the alert contact: email at minimum. Verify it by deliberately breaking something —
    stop the container in Coolify for five minutes and confirm an alert actually arrives. **Do
    this once; an untested alert channel is not a monitor.**

**Healthchecks.io (~10 minutes)**
16. Create a free account at <https://healthchecks.io/>.
17. Create a check named "litestream-replicating" with a period of, say, 1 hour and a grace of
    1 hour. Copy its ping URL.
18. Add an hourly cron (on the VPS, or as a tiny scheduled task in Coolify) that runs
    `litestream ltx` (or inspects the newest object in the bucket), confirms the newest entry is
    recent, and **only then** curls the ping URL. If replication has stalled, the ping stops and
    Healthchecks emails within the grace period.
19. Create a second check, "restore-drill," with a 30-day period. Ping it **by hand** only after
    completing the §3.3 drill. If a month slips, it nags.

**Recurring, forever**
20. **Monthly:** run the restore drill in §3.3 on a machine that is not the VPS, and record the
    observed RPO.
21. **At every schema migration:** run the drill again immediately afterwards. A migration is the
    most likely single cause of an unrestorable backup.
22. Keep the recovery runbook (§3.2) in the password manager next to the credentials, not in the
    repo alone — the repo is useless if the only clone is on the destroyed VPS.

---

## 8. Things explicitly not verified

Flagged so nobody treats them as established:

1. **Hetzner Object Storage's exact monthly price** — the figure did not render in the fetched
   page. <https://www.hetzner.com/storage/object-storage/>
2. **UptimeRobot free-tier SMS/voice credit allowance** — listed as available, quantity not
   stated. Plan on email being the free channel.
3. **Better Stack free-tier check frequency** — not stated on the pricing page fetched.
4. **Coolify's monitoring/notification polling interval** and **whether Coolify auto-restarts
   failed containers** — neither was addressed in the docs pages fetched. Mitigation: set
   `restart: unless-stopped` explicitly in Compose.
5. **Turso Cloud pricing and free-tier limits** — not researched; the option was ruled out on
   architecture grounds (driver swap), not on cost.
6. **rqlite / dqlite / Marmot / cr-sqlite current status** — not checked against primary sources.
   Ruled out on the "fewer moving parts" preference without a maintenance audit.
7. **Backblaze B2 Object Lock vs. Litestream retention deletion** — plausible conflict, untested.
   Litestream deletes expired LTX files as of v0.5.8
   (<https://litestream.io/reference/config/>); Object Lock prevents deletion. Test in a
   throwaway bucket before enabling.
8. **The R2 worst-case Class A operation estimate in §2** is my own arithmetic from Cloudflare's
   published rates, not a Cloudflare statement.
9. **Litestream v0.5's behaviour under `better-sqlite3` specifically** — no first-party
   integration test exists or was run. The reasoning is that Litestream is driver-agnostic by
   design (<https://litestream.io/>); that is sound, but it is inference, and step 8 of §7
   (verifying LTX files appear) is how it gets confirmed in practice.

---

## Sources

- Litestream: <https://litestream.io/> · <https://litestream.io/how-it-works/> ·
  <https://litestream.io/getting-started/> · <https://litestream.io/install/> ·
  <https://litestream.io/tips/> · <https://litestream.io/reference/> ·
  <https://litestream.io/reference/config/> · <https://litestream.io/reference/restore/> ·
  <https://litestream.io/guides/docker/> · <https://litestream.io/guides/backblaze/>
- Litestream repo/releases: <https://api.github.com/repos/benbjohnson/litestream> ·
  <https://api.github.com/repos/benbjohnson/litestream/releases> ·
  <https://hub.docker.com/v2/repositories/litestream/litestream/tags>
- LiteFS: <https://api.github.com/repos/superfly/litefs>
- Turso: <https://docs.turso.tech/introduction>
- SQLite: <https://www.sqlite.org/lang_vacuum.html>
- better-sqlite3: <https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md> ·
  <https://api.github.com/repos/WiseLibs/better-sqlite3/releases>
- Coolify: <https://coolify.io/docs/databases/backups> ·
  <https://coolify.io/docs/core/persistent-storage/storage-mounts/backups> ·
  <https://coolify.io/docs/knowledge-base/health-checks> ·
  <https://coolify.io/docs/knowledge-base/notifications> ·
  <https://coolify.io/docs/core/observability/monitoring/overview> ·
  <https://coolify.io/docs/knowledge-base/docker/compose>
- Storage pricing: <https://www.backblaze.com/cloud-storage/pricing> ·
  <https://developers.cloudflare.com/r2/pricing/> ·
  <https://www.hetzner.com/storage/object-storage/>
- Monitoring: <https://uptimerobot.com/pricing/> · <https://betterstack.com/uptime/pricing> ·
  <https://healthchecks.io/pricing/> · <https://api.github.com/repos/healthchecks/healthchecks> ·
  <https://api.github.com/repos/louislam/uptime-kuma> ·
  <https://github.com/louislam/uptime-kuma/wiki/Notification-Methods> ·
  <https://github.com/louislam/uptime-kuma/tree/master/server/notification-providers>
