# Release-candidate audit — OpsPilot V2

Written before any RC hardening change, from reading the repository as it stands after V2 Phase 5.
Every statement below is what the code did at that point; the "risk" entries are what this phase
tested or fixed. **Outcome per finding is in §11 at the end**; the changes themselves are recorded
in [RC1-CHANGES.md](RC1-CHANGES.md).

## 1. Architecture as it is

| Layer | What | Where |
| --- | --- | --- |
| Browser | React 19 SPA, hash routing, hand-written CSS with tokens, lazy-loaded staff/admin routes; `fetch` with credentials, CSRF header on every mutation; one `EventSource` per tab for live hints | `web/` |
| API | Express 5 on Node 24, one process, Zod-validated input, session cookie (server-side rows), role guards `staff`/`admin`, object-level checks (`canAccess`, `assetScope`, `articleScope`, `inboxWhere`) | `server/` |
| Data | PostgreSQL 16–18 through Prisma 7 (`@prisma/adapter-pg`); 25 models, 43 indexes/uniques, 9 migrations; pgvector for knowledge retrieval | `prisma/` |
| Files | Ticket attachments on disk under `UPLOAD_DIR/<ticketId>/<random>.<ext>`, metadata in `Attachment`; never served from the web root | `server/workspace.ts` |
| Background | In-process notification worker (outbox with leases/backoff), daily retention, SSE bus (process-local) | `server/notifications.ts`, `governance.ts`, `realtime.ts` |
| AI | Provider abstraction (`disabled`/`mock`/`openai`), server-enforced evidence thresholds, daily per-user limit and concurrency cap | `server/ai/` |

Shared contracts (`shared/contracts.ts`, `shared/model.ts`) are imported by both sides, so the
browser cannot send a shape the server has not declared.

## 2. Startup paths

1. **Windows one-click**: `start.bat` → checks Node ≥ 24 → `scripts/start.mjs` → runs `npm run setup`
   on first run (creates `.env`, installs, picks Docker/embedded/existing PostgreSQL, migrates, seeds
   when `ALLOW_DEMO_SEED=true`) → chooses `npm run dev` (DB answering) or `npm run dev:local`
   (embedded PostgreSQL in `.local-db/`) → `upgrade-db.mjs` applies pending migrations → opens the
   browser when `/api/health` answers.
2. **Developer**: `npm run setup`, then `npm run dev:local` or `npm run dev`.
3. **Production container**: `Dockerfile` (multi-stage, unprivileged `node`, read-only root FS,
   `HEALTHCHECK` on `/api/health/ready`) → `docker/entrypoint.sh` applies migrations unless
   `SKIP_MIGRATIONS=1` → `node dist/server/index.js`, which serves `dist/web` itself in production.
   `compose.prod.yaml` adds a one-shot `migrate` job, PostgreSQL 18 + pgvector, Caddy for TLS, named
   volumes `pgdata` and `uploads`.

Configuration is parsed once by `server/config-schema.ts` (pure, Zod). Production refuses to start
without `APP_SECRET`, with `ALLOW_DEMO_SEED=true`, with a non-HTTPS `APP_ORIGIN`, or with Mailpit.
`scripts/check-production.ts` (`npm run doctor:prod`) validates `.env.production` with the same
parser before anything is deployed.

## 3. Production assumptions

- One API process per deployment. The SSE bus and the rate limiter are in-memory; a second replica
  works but each tab hears only its own process and limits are per process. Documented in code, not
  yet in the operator docs.
- A reverse proxy terminates TLS and sets `X-Forwarded-*`; `trust proxy` is `1` in production.
  Caddy is the shipped example; nothing else is Caddy-specific except the `X-Request-Id` pass-through.
- `dist/web` is served by Express with `maxAge: 1h`; the SPA falls back to `index.html`.
- Attachments need a persistent, writable path; everything else in the container is read-only.
- Migrations run before the server (entrypoint or the `migrate` job). `/health/ready` reports 503
  while any migration row is unfinished.

## 4. Security controls present today

| Area | Control |
| --- | --- |
| Sign-in | scrypt (N=2^17, r=8, p=1, 64-byte key, per-user salt, constant-time compare); a dummy hash is verified when the account does not exist so timing is equal; one generic 401 message for unknown, wrong password, locked and disabled; per-IP limiter on `/auth/login` and `/auth/reset` (`LOGIN_RATE_LIMIT`/15 min) and a tighter one on `/auth/forgot`; lockout after `LOCKOUT_THRESHOLD` failures |
| Sessions | random 32-byte token, stored as SHA-256; `httpOnly`, `SameSite=Strict`, `Secure` + `__Host-` prefix in production; 8 h default; login deletes the presented old session (no fixation) and expired rows; per-session revocation and "sign out everywhere"; MFA-pending sessions can reach only the MFA/logout routes |
| CSRF | exact `Origin` match on every non-GET `/api` request **and** a per-session token in `X-CSRF-Token`, compared in constant time |
| Second factor | TOTP with replay protection (`mfaLastStep`), secrets AES-encrypted with `APP_SECRET`, hashed recovery codes, optional per-role requirement |
| Passwords | policy (length ≥ 12, not common, not containing the person's name), forced change at first sign-in, reset by emailed or administrator-issued one-time link (30 min / 24 h), all sessions revoked on reset |
| Authorization | `staff`/`admin` route guards plus object-level `canAccess` (requester, assignee, watcher, approver, department manager, staff), `assetScope`, `articleScope`, `inboxWhere`; the permission matrix test fails when a route is undocumented |
| Uploads | allow-list by extension **and** declared type **and** magic bytes for binary types; 10 MB default, one file per request; random storage key inside a per-ticket directory; download forces `Content-Disposition: attachment`, `nosniff`, `CSP: default-src 'none'; sandbox`, `Cache-Control: no-store`; delete restricted to uploader or administrator |
| Headers | `helmet()` defaults (CSP, HSTS in production, frame-ancestors, referrer policy, etc.); `X-Powered-By` off; Caddy adds HSTS and removes `Server` |
| Input | Zod on every body and query; JSON limited to 32 kB; sort fields are enums, never raw column names; UUIDs validated; bulk actions capped at 100 ids |
| Errors | production responses carry only a message and `requestId`; stack traces are logged only outside production; Prisma/Zod/JSON/413 mapped to safe messages |
| Logging | structured JSON per request: id, method, route (ids collapsed), status, duration, IP, user id, user agent — no bodies, no query strings, no cookies |
| Audit | append-only `Event` rows for every auth and admin action with source IP; no endpoint updates or deletes them |
| Metrics | `/metrics` behind a bearer token, 404 when unset, blocked at the proxy |
| Retention | daily pruning of non-ticket audit rows, AI usage and delivered outbox rows by configured days; erasure keeps attributed records |

## 5. Operational risks (to test in this phase)

| # | Risk | Where | Initial grade |
| --- | --- | --- | --- |
| O1 | Graceful shutdown: `server.close()` waits for open SSE streams, which never end on their own; the 10 s deadline then exits with code 1 and a warning on every container stop | `server/index.ts`, `realtime.ts` | P2 |
| O2 | Session expiry during work: a 401 from any mutation sets `user=null`, which unmounts the workspace and discards the draft | `web/main.tsx` | P2 |
| O3 | Network loss: `api()` surfaces `fetch`'s "Failed to fetch" and any non-JSON body (a proxy 502 page) throws a JSON parse error instead of a readable message | `web/api.ts` | P2 |
| O4 | Database outage while running: Prisma errors reach the 500 handler (safe), but readiness semantics and client behaviour under repeated 500s are untested | `server/app.ts` | P2 (test) |
| O5 | `start.bat` prints a generic "something went wrong"; it does not itself distinguish a database connection failure from a migration failure (the scripts underneath do) | `start.bat`, `scripts/*.mjs` | P3 |
| O6 | Backup script passes the connection URL (with password) as a `pg_dump` argument, visible in the process list while it runs | `scripts/backup.mjs` | P2 |
| O7 | SSE bus is process-local; no operator note about multi-replica behaviour or proxy buffering | docs | P3 (docs) |

## 6. Deployment risks

| # | Risk | Initial grade |
| --- | --- | --- |
| D1 | The production image has been built in CI but the full compose stack (migrate job, uploads volume persistence across container recreation, Caddy) has not been run end-to-end on a host. Docker is not available in the sandbox used for this phase; what can and cannot be verified is stated in the RC1 report | P1 if a defect exists; unknown until run |
| D2 | `read_only: true` root FS: multer uses memory storage and writes only to `/app/uploads`; `/tmp` is tmpfs. Prisma engine writes nothing. Believed correct; verified only by inspection | P2 |
| D3 | `entrypoint.sh` migrates on every start unless `SKIP_MIGRATIONS=1`; compose sets it for `app`, so a second replica never runs DDL. A bare `docker run` would migrate — acceptable, documented | P3 |
| D4 | No documented reverse-proxy requirements (SSE buffering, upload size, timeouts) for proxies other than the shipped Caddyfile | P2 (docs) |

## 7. Data risks

| # | Risk | Initial grade |
| --- | --- | --- |
| DA1 | CSV exports (reports, audit) quote commas/quotes/newlines correctly but do not neutralise cells beginning with `=`, `+`, `-`, `@`, tab or CR — a ticket title such as `=HYPERLINK(...)` becomes a live formula when opened in a spreadsheet | P2 (fix) |
| DA2 | Restore replaces the whole database; the script requires `--confirm` and prints what it will overwrite. Restore has been exercised only with the embedded database's file copy, not with `pg_restore` | P2 (test) |
| DA3 | Attachment files and database rows are two stores; deleting a ticket is not exposed, so orphans arise only if an upload's DB insert fails after the file is written (file without row — harmless, not reclaimed) | P3 |
| DA4 | Ticket updates use `version` (optimistic) plus `SELECT … FOR UPDATE`; replies, reopen, approvals and board moves lock the row. Bulk actions and the `PATCH` of properties from two agents are the concurrency cases to exercise | P2 (test) |
| DA5 | Date-only fields: `dueAt` is stored as a timestamp from a browser-supplied string; report windows are computed server-side from `now`. Timezone handling needs a written rule | P3 |

## 8. Performance risks

| # | Risk | Initial grade |
| --- | --- | --- |
| PF1 | `GET /api/dashboard` (staff) loads **every** ticket with includes to compute metrics; at 10k tickets this is a full-table read per Command-Center-adjacent visit | P2 |
| PF2 | `GET /api/tickets?sla=…` evaluates the SLA position of every active ticket in memory before paginating (correct, unindexable, bounded by active count) | P3 (measure) |
| PF3 | `GET /api/board` takes 500 tickets without a total; columns beyond that are silently cut | P3 (document) |
| PF4 | `/analytics` and `/reports/:kind` read every ticket in the window (≤ 365 days) with includes; fine at demo scale, unmeasured at 10k | P2 (measure) |
| PF5 | `/search` runs six `contains` queries (ILIKE) including article markdown; no trigram index; bounded by `take` | P3 (measure) |
| PF6 | `/operations/summary` loads active tickets, recent events, surveys, assets and pending approvals per call; refreshed on every SSE hint | P2 (measure) |
| PF7 | Client bundle 580 kB (160 kB gzip) main chunk after lazy routes; no analysis of what is in the main chunk | P3 |

## 9. Already sufficiently hardened (no work planned beyond regression tests)

Password hashing and comparison; account enumeration on login/forgot/reset; session storage and
cookie flags; CSRF (double control); MFA and recovery codes; per-IP login limiting with lockout;
upload allow-listing, magic bytes and download headers; helmet defaults; JSON body limit; Zod on
every input with enum sorts; safe 500 handler; structured logs without bodies; request ids
(honoured from the proxy, generated otherwise); append-only audit; liveness/readiness split;
retention; the permission matrix test that fails on undocumented routes; test databases guarded by
name suffix and inspection; demo seed refusing production, non-local hosts and non-demo accounts.

## 10. What this phase will do, in order

1. Clean-install proof and `start.bat` review (Parts 1–2).
2. Configuration classification and `.env.example` refresh (Part 3); database failure-mode tests
   (Part 4); migration and seed audit (Parts 5–6); backup/restore procedure and test (Part 7).
3. Security: fix DA1 (CSV), O6 (backup credential), add security regression tests for object-level
   access, search leakage, mass assignment, CSV, attachments (Parts 8–22, 39–42).
4. Reliability: fix O1 (SSE on shutdown), O2 (re-authenticate in place), O3 (network/non-JSON
   errors); test DB down, network loss, session expiry, SSE reconnect, concurrency (Parts 23–30,
   36–38).
5. Performance: scale dataset, measure PF1/PF4/PF6, fix what the numbers justify (Parts 31–35).
6. Docker/production config review, proxy documentation (Parts 43–46).
7. Documentation, regression passes, test isolation and flake audit, clean build, final report
   (Parts 47–69).

No schema migration is planned. If measurement in step 5 justifies an index, it will be documented
here before it is written.

## 11. Outcome per finding (after the phase)

| Finding | Result |
| --- | --- |
| O1 SSE blocks shutdown | Fixed (RC1-CHANGES #6): exit 0 in 44 ms with an open stream |
| O2 session expiry discards work | Fixed (#4): in-place re-authentication, e2e-tested |
| O3 network / non-JSON errors | Fixed (#5), e2e-tested |
| O4 database outage behaviour | Tested: readiness 503, data requests now 503 with `Retry-After` (#7), automatic recovery |
| O5 `start.bat` generic failure | Fixed (#15): exit codes 10/11/12 explained; configuration validated before start |
| O6 backup credential in argv | Fixed (#11) |
| O7 multi-replica / proxy notes | Documented: DEPLOYMENT.md reverse-proxy table, OPERATIONS-RUNBOOK §9 |
| D1 Docker stack unverified | Still unverified here (no Docker in the sandbox); production-mode server, preflight and entrypoint logic verified outside a container; rows 15–17 of the release checklist are for the release host |
| D2 read-only root FS | Inspected only; multer uses memory storage, writes go to `/app/uploads` only |
| D3 entrypoint migrates on bare `docker run` | Acceptable; preflight added before it (#3) |
| D4 proxy requirements | Documented (see O7) |
| DA1 CSV formula injection | Fixed (#2), tested |
| DA2 restore only tested by file copy | File-level path run end to end (backup → change → restore → verified); `pg_restore` path inspected; documented in BACKUP-RESTORE.md |
| DA3 orphan upload files | Left, documented |
| DA4 concurrency | Tested (#1 fixed a real race in approvals; version conflict, resolve-vs-reply, board move, bulk all hold) |
| DA5 timezone rule | Fixed for calendar dates (#12); rule written in DESIGN-SYSTEM/runbook: timestamps in the viewer's zone, calendar dates in UTC, server computes windows from its clock in UTC |
| PF1 legacy `/dashboard` reads all tickets | Not on the UI path; rate-limited (#14) and documented as legacy |
| PF2 SLA filter in memory | Measured: 27 ms at 310 active tickets; acceptable, unchanged |
| PF3 board 500 cap | Documented |
| PF4 analytics/reports | Fixed (#8, #9): 4.36 s → 0.58 s; JSON rows capped, CSV complete |
| PF5 search | Measured 10–20 ms at 10k tickets / 1k articles; rate-limited |
| PF6 operations summary | Fixed (#8): 0.53 s → 0.06 s |
| PF7 bundle | Measured with a source map; zod removed from the client (#10): 580 → 502 kB |
| New during the phase | Approval decision race (P1, #1); SlaPolicy reference rows must survive a test reset (#16); modal dialogs lacked a focus trap (fixed with #4) |
