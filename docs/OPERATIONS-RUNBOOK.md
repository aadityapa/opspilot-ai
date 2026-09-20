# Operations runbook

Practical procedures for running OpsPilot V2. Two shapes are covered throughout: **Windows /
developer** (`start.bat` or `npm run dev:local`, embedded or Docker PostgreSQL) and **production
container** (`compose.prod.yaml`). Where a command differs, both are given. Never paste a
`DATABASE_URL` with its password into a ticket or chat; every script here prints host and database
name only.

## 1. Start, stop, restart

| | Windows / developer | Production container |
| --- | --- | --- |
| Start | double-click `start.bat`, or `npm.cmd run dev:local` | `docker compose -f compose.prod.yaml --env-file .env.production up -d` |
| Stop | Ctrl+C in the window (the API stops accepting work, finishes in-flight requests, ends live-update streams, closes the database) | `docker compose -f compose.prod.yaml stop app` (SIGTERM; the container exits 0 within ~1 s when idle, at most 10 s) |
| Restart | Ctrl+C, then start again | `docker compose -f compose.prod.yaml restart app` |
| Status | the window shows `{"message":"listening"}` | `docker compose -f compose.prod.yaml ps` — `app` must be `healthy` |

Exit codes from the API process: `0` clean stop; `10` database unreachable, refused the password, or
missing (nothing was started); `11` migrations failed; `12` invalid configuration (the setting is
named in the last log line); `1` forced exit after the 10 s shutdown deadline.

## 2. Health checks

| Endpoint | Meaning | Use |
| --- | --- | --- |
| `GET /api/health/live` | the process is running and can answer; never touches the database | container liveness, "is it up at all" |
| `GET /api/health/ready` | `200 {"status":"ready"}` only when the database answers, every migration row is finished and the process is not shutting down; otherwise `503` with `checks` naming what failed | load balancer / compose healthcheck, "can it serve" |
| `GET /api/health` | legacy: database reachable → `{"status":"ok"}` | `start.bat` waits on this |

Both are unauthenticated and disclose nothing beyond those three booleans.

```
curl -s http://localhost:3001/api/health/ready
docker compose -f compose.prod.yaml exec app curl -s http://127.0.0.1:3001/api/health/ready
```

## 3. Logs

One JSON line per API request on stdout (`LOG_FORMAT=json`): `ts, level, message:"request",
requestId, method, route` (ids collapsed to `:id`), `status, durationMs, ip, userId, userAgent`.
Errors and warnings go to stderr with the same `requestId`. Nothing in a log line reconstructs a
request body, a ticket, a cookie or a header other than the user agent.

```
docker compose -f compose.prod.yaml logs -f --tail=200 app
docker compose -f compose.prod.yaml logs app | grep '"level":"error"'
docker compose -f compose.prod.yaml logs app | grep <requestId>      # the id shown to the user on an error page
```

The proxy passes its own request id in `X-Request-Id`; the API honours a well-formed one and
generates a UUID otherwise, and returns it in the `X-Request-Id` response header and in every error
body, so a user's screenshot of "Something went wrong · request …" leads straight to the log line.

## 4. Database connectivity

Preflight from the application host, no credentials printed:

```
node dist/server/preflight.js                      # production image
npx tsx server/preflight.ts                        # source checkout
```

It answers one of: reachable (with server version); `nothing is answering at host:port`;
`authentication failed`; `database "x" does not exist — create it, or fix DATABASE_URL`. The same
check runs before migrations in the container entrypoint and the compose `migrate` job, and at API
start (up to ten attempts, three seconds apart, for a database that is still booting; wrong
password and missing database stop immediately).

While the database is down the API keeps running: `/health/ready` is 503, every data request
answers `503 {"error":"The database is not reachable right now…","requestId"}` with `Retry-After: 5`,
the interface shows that message and keeps whatever was being typed, and service resumes on its own
when the database returns — no restart needed (tested: outage and recovery mid-run).

## 4a. Database encoding (UTF-8 is required)

OpsPilot stores UTF-8 text. Every audit detail reads like `status: OPEN → RESOLVED`, and articles,
replies and names carry dashes, quotes and any language someone types. A PostgreSQL cluster created
in the machine's own locale is often **WIN1252** on Windows, which cannot represent those
characters: the write fails with SQLSTATE 22P05 and the API answers 500 on ordinary ticket updates.

Startup refuses such a cluster rather than letting it fail later:

```
{"level":"error","message":"database preflight failed","reason":"the database was created with the
WIN1252 encoding, but OpsPilot stores UTF-8 text — ticket updates would fail. …"}
```

Check an existing database with `SHOW server_encoding;` (or `node dist/server/preflight.js`, which
prints the encoding when it passes). The encoding of a cluster **cannot be changed in place**; it is
fixed at creation. To recover a local development database:

```powershell
npm.cmd run db:backup                      # keeps a copy of the old cluster
# stop the database, then:
rmdir /s /q .local-db
npm.cmd run setup                          # creates a UTF-8 cluster and re-seeds the demo story
```

For a server database, create a new one with `CREATE DATABASE opspilot TEMPLATE template0 ENCODING
'UTF8';`, restore into it, and point `DATABASE_URL` at it. New local clusters are created as UTF-8
with the C locale by `scripts/local-db.mjs`; the production compose file uses the `pgvector/pgvector`
image, which is UTF-8 already.

## 5. Backup and restore

See [BACKUP-RESTORE.md](BACKUP-RESTORE.md). Short form: `npm run db:backup` (pg_dump custom format,
or a file copy of the embedded database while it is stopped); `npm run db:restore -- <file>
--confirm`; back up the `uploads` volume with the database.

## 6. Migrations

Migrations are additive and idempotent; applying them on every start is safe (Prisma takes an
advisory lock, a second replica finds nothing to do). Production applies them in the one-shot
`migrate` job before `app` starts; `app` runs with `SKIP_MIGRATIONS=1`.

```
npm run db:migrate                                                   # developer
docker compose -f compose.prod.yaml run --rm migrate                 # production, on demand
docker compose -f compose.prod.yaml exec app node node_modules/prisma/build/index.js migrate status
```

A missing database is never created by a migration run (preflight refuses first). If `migrate
status` reports an unfinished migration, readiness stays 503: inspect the `_prisma_migrations` row,
fix the cause, and re-run `migrate deploy`; do not delete the row.

## 7. Disk, storage and uploads

Attachments live under `UPLOAD_DIR` (`/app/uploads` in the container, the `uploads` named volume).
The container root filesystem is read-only; that path and `/tmp` are the only writable ones.

```
docker compose -f compose.prod.yaml exec app df -h /app/uploads
docker compose -f compose.prod.yaml exec app ls -ld /app/uploads      # must be owned by node (uid 1000)
docker system df                                                      # volumes and image space
```

Uploads failing with 500 while everything else works usually means the volume is full or owned by
root (a volume created before the image's `chown` ran): `docker compose exec -u root app chown
node:node /app/uploads`. Attachment rows without a file answer 404 "The file is no longer
available"; a file without a row (an upload whose database insert failed) is harmless and can be
removed by hand.

## 8. Common startup errors

| Log / message | Cause | Action |
| --- | --- | --- |
| `invalid configuration` + setting name, exit 12 | a required setting missing or malformed | fix that setting in `.env` / `.env.production`; run `npm run doctor:prod` |
| `database preflight failed … nothing is answering` (exit 10) | database not started, wrong host/port, firewall | start the database; check `DATABASE_URL` host and port |
| `… authentication failed` (exit 10) | wrong password or user | correct `POSTGRES_PASSWORD` / the URL; a changed password needs the database's own password changed too |
| `… does not exist` (exit 10) | typo in the database name, or a fresh server without it | create the database (or fix the name); `npm run setup` creates the three local ones |
| `Applying migrations failed` (exit 11) | schema drift or a failed migration row | `migrate status`; see §6 |
| `Production requires APP_SECRET` | secret absent in production | generate one (see `.env.production.example`), never reuse across installs |
| `Production requires HTTPS and demo seeding disabled` | `APP_ORIGIN` not https, or `ALLOW_DEMO_SEED=true` | fix both |
| `EADDRINUSE` | port already taken | stop the other process or change `PORT` |
| `… was created with the WIN1252 encoding …` (exit 10) | the cluster is not UTF-8 | §4a |
| `PostgreSQL was started but nothing is accepting connections on 127.0.0.1:5433` | the local cluster needs crash recovery after an unclean stop | start it once with `pg_ctl -D ".local-db\data" -l recovery.log start`, read `recovery.log`, then `pg_ctl … -m fast stop` and start normally |
| `Request origin rejected` on every sign-in | browser address differs from `APP_ORIGIN` (`127.0.0.1` vs `localhost`, http vs https, port) | open exactly `APP_ORIGIN` |

## 9. Live updates (SSE) troubleshooting

The interface opens one `GET /api/events/stream` per tab. Symptoms and causes:

- Footer says **Live updates reconnecting…** permanently: the proxy is buffering or timing out the
  stream. It must pass `text/event-stream` responses through unbuffered with no idle timeout under
  ~60 s (the server sends a `: ping` comment every 25 s). Caddy does this by default; nginx needs
  `proxy_buffering off; proxy_read_timeout 1h;` on that path. Check
  `curl -N -H "Cookie: …" https://host/api/events/stream` shows `event: hello` at once.
- Reconnecting after every deploy: expected — shutdown sends `event: bye` and ends the stream; the
  browser reconnects within 5 s and refetches once. A toast says "Live updates restored."
- Updates arrive only for some users: with several API replicas the bus is per process; a tab hears
  changes made through its own replica immediately and others on its next refetch. Use one replica
  or add a shared channel before scaling out.
- Nothing at all: the session has ended (the browser stops reconnecting on 401) — the next action
  will show the sign-in dialog.

## 10. Rollback

Application: run the previous image tag (`IMAGE_TAG=<previous>` and `up -d`). Migrations are
additive, so an older application version runs against a newer schema. Database: restore the backup
taken before the upgrade (§5) only if data must be rolled back too — this loses changes made since.
Uploads: restore the volume snapshot from the same moment, or attachment rows may point at files that
no longer exist (they answer 404, nothing crashes).

## 11. Incident diagnostics

| Symptom | Look at | Likely cause |
| --- | --- | --- |
| Application will not start | last stderr line, exit code (§1, §8) | configuration or database |
| Database unavailable at runtime | `/health/ready` 503 with `database:fail`; 503 responses in logs | PostgreSQL down / network; recovers automatically |
| Login failures spike | audit log: `LOGIN_FAILED` rows by `ip`; `Administration → Audit log`; `LOGIN_LOCKED` rows | credential stuffing (per-IP limiter and lockout are engaging) or a changed `APP_ORIGIN` (every attempt is `Request origin rejected`, status 403 not 401) |
| Uploads fail | §7; error body says "limited to N MB" (413-class) vs "type not allowed" (400) vs 500 | size, type, volume full or unwritable |
| SSE disconnected | §9 | proxy buffering / timeout |
| Disk nearly full | `docker system df`, `df -h` on the volume host; the outbox and audit tables (retention §12) | attachments or logs (compose caps json-file logs at 5 × 20 MB) |
| Migration fails | §6 | drift; unfinished row |
| Everything slow | request `durationMs` in logs; `/metrics` histograms; `SELECT count(*) FROM "Ticket"` | volume beyond what was measured (10k tickets: analytics ≤ 0.6 s, lists ≤ 50 ms) |

## 12. Retention and what is kept

| Data | Kept | Automated removal |
| --- | --- | --- |
| Tickets, replies, internal notes, approvals, watchers, form answers, surveys (CSAT) | indefinitely | none — no ticket retention policy exists |
| Attachments (files + rows) | with their ticket | none automated; deleted only through the interface by the uploader or an administrator |
| Notifications (outbox rows) | delivered/failed rows for `RETENTION_OUTBOX_DAYS` (30) | daily |
| Audit events attached to a ticket | indefinitely | never |
| Audit events not attached to a ticket (sign-ins, admin actions) | `RETENTION_AUDIT_DAYS` (365; 0 = forever) | daily |
| AI usage records | `RETENTION_AI_USAGE_DAYS` (90) | daily |
| Knowledge feedback (helpful / not helpful) | with the article | none |
| Sessions | until expiry or revocation | expired rows deleted at each sign-in |
| Password-reset tokens | until used or expired (30 min / 24 h) | superseded tokens deleted on use |

Personal-data export and erasure (identifiers, credentials, ownership removed; attributed records
kept as "Deleted user") are administrator actions in Accounts & access — see
[GOVERNANCE.md](GOVERNANCE.md).
