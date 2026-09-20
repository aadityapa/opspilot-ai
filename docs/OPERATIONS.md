# Operations

How to know the application is healthy, what it tells you when it is not, and how to keep its data.

## Health

| Endpoint | Answers | Use it for |
| --- | --- | --- |
| `GET /api/health/live` | 200 always, with uptime. Never touches the database | Liveness: restart the process if this stops answering |
| `GET /api/health/ready` | 200 `{status:"ready", checks:{database, migrations, notShuttingDown}}`, else 503 | Readiness: route traffic only while this is 200 |
| `GET /api/health` | 200 `{status:"ok"}` when the database answers | Kept for compatibility with earlier phases |

Readiness goes to 503 the moment a shutdown signal arrives, before the listener closes, so a load
balancer stops sending work while in-flight requests finish (up to ten seconds; a second signal
forces exit). The Docker image's `HEALTHCHECK` uses readiness.

## Logs

One JSON object per line on stdout (errors and warnings on stderr). A request line looks like:

```json
{"ts":"2026-09-10T10:12:31.204Z","level":"info","message":"request","requestId":"6f1c…","method":"POST","route":"/api/tickets/:id/replies","status":201,"durationMs":41.3,"ip":"203.0.113.9","userId":"2c64…","userAgent":"Mozilla/5.0 …"}
```

- `requestId` is generated per request, or taken from an incoming `X-Request-Id` header when it is
  well formed (Caddy sets one). It is returned in the `X-Request-Id` response header and included
  in every 500 response body, so a person reporting "something went wrong" can quote it.
- `route` collapses identifiers (`/api/tickets/:id`), so one endpoint is one value.
- **Never logged:** request bodies, query strings, cookies, authorization headers, ticket or
  article text, prompts, AI output. An unhandled error logs its name and message; the stack only
  outside production.

`LOG_FORMAT=off` silences request lines. Application events (`listening`, `shutting down`,
`retention run`) use the same shape.

## Metrics

`GET /metrics` serves Prometheus text format when `METRICS_TOKEN` is set, to a client presenting
`Authorization: Bearer <token>`. Without the setting the endpoint is a 404; with the wrong token, 401.

| Metric | Type | Meaning |
| --- | --- | --- |
| `http_requests_total{method,route,status_class}` | counter | Requests handled |
| `http_request_duration_seconds{method,route}` | histogram | Latency, buckets from 5 ms to 10 s |
| `opspilot_tickets_open` | gauge | Tickets not resolved or closed |
| `opspilot_tickets_sla_breached` | gauge | Unresolved tickets past a deadline |
| `opspilot_outbox_pending` / `opspilot_outbox_failed` | gauge | Notification delivery backlog and exhausted retries |
| `opspilot_users_active` | gauge | Active, non-erased accounts |
| `opspilot_sessions_active` | gauge | Verified, unexpired sessions |
| `process_uptime_seconds`, `process_resident_memory_bytes`, `nodejs_heap_used_bytes` | gauge | Process |

Application gauges are computed from the database and cached for fifteen seconds, so a scrape
cannot become a load. Counters and histograms are per process; with more than one replica, scrape
each.

In production Caddy returns 404 for `/metrics` at the edge. Scrape from inside the `backend`
network: `http://app:3001/metrics`.

## Backups

```powershell
npm.cmd run db:backup                      # → backups/opspilot-<timestamp>.dump
npm.cmd run db:restore -- backups/opspilot-<timestamp>.dump            # dry run: says what it would replace
npm.cmd run db:restore -- backups/opspilot-<timestamp>.dump --confirm
```

`db:backup` uses the first of: `pg_dump` on PATH; `pg_dump` inside the compose `db` container; a
file-level copy of `.local-db/data` for the self-contained database (only while it is stopped —
a copy taken during writes is not guaranteed consistent, and the script refuses). Backups are
PostgreSQL custom format (`--no-owner --no-privileges`), restorable with `pg_restore`; the
self-contained copy is a `.tar` of the data directory.

A backup contains every ticket, article and account, password hashes and encrypted authenticator
secrets included. Keep it off the host and treat it as you would the database.

**Restore** refuses to run without `--confirm`, states the target database and what it currently
holds, and for a `.dump` runs `pg_restore --clean --if-exists --single-transaction`. Run
`npm run db:migrate` afterwards in case the backup predates the current schema.

For production, schedule `db:backup` from the host (cron) with `DATABASE_URL` pointing at the
compose database, or run `pg_dump` inside the container directly:
`docker compose -f compose.prod.yaml exec -T db pg_dump -Fc -U opspilot opspilot > backup.dump`.

## Retention

A daily job removes what the policy says has aged out. Zero means keep forever.

| Setting | Default | Removes |
| --- | --- | --- |
| `RETENTION_AUDIT_DAYS` | 365 | Standalone audit events (sign-ins, admin actions). **Events attached to a ticket are never pruned** — they are the ticket's record |
| `RETENTION_AI_USAGE_DAYS` | 90 | AI usage rows (counts and token totals; no content was ever stored) |
| `RETENTION_OUTBOX_DAYS` | 30 | Delivered, cancelled and failed notifications |
| — | always | Expired sessions, used or expired reset tokens |

The Users page shows the policy, what is currently eligible, and a button to apply it now. Every
run that removes something writes a `RETENTION_RUN` audit event with the counts.

## Graceful shutdown

On `SIGTERM`/`SIGINT`: readiness → 503, the notification worker and retention timer stop, the
listener closes and idle keep-alive connections are dropped, in-flight requests get ten seconds,
the database pool disconnects, exit 0. A second signal exits 1 immediately. `docker stop` sends
`SIGTERM` and waits ten seconds by default, which matches.

## When something is wrong

| Symptom | Look at |
| --- | --- |
| Readiness 503 with `migrations: fail` | A migration did not finish. `prisma migrate status`; the `migrate` service's logs in production |
| Readiness 503 with `database: fail` | The database is unreachable from the app. `DATABASE_URL`, network, credentials |
| A person reports a request id | `grep <id>` in the logs; the `error` line beside the `request` line has the error name |
| `opspilot_outbox_failed` rising | Mail delivery is failing. In production mail is disabled by design; locally, is Mailpit up? Settings → Notification outbox shows each failure |
| `opspilot_tickets_sla_breached` rising | Not an operations problem — the queue needs people. The dashboard lists which tickets |
| Sign-ins failing for everyone | `LOGIN_RATE_LIMIT` is per source address; behind a proxy without `trust proxy`, every client shares one. Production sets `trust proxy` to one hop |
