# OpsPilot V2 RC1 Host Validation

Executed on the release host on **20 September 2026**. Everything below was run; nothing here is
inferred from reading code. Where something could not be run, it says so and why.

## Environment

| | |
| --- | --- |
| Windows | Microsoft Windows 10 Pro, version 10.0.19045.6466 |
| CPU architecture | AMD64 (x64) |
| Node | v24.16.0 |
| npm | 11.13.0 |
| Git | 2.55.0.windows.4 |
| PostgreSQL | embedded PostgreSQL 18.4 (x86_64-windows, msvc-19.44.35226) in `.local-db/`, started by `scripts/local-db.mjs`; a separate `postgresql-x64-18` Windows service is installed on the machine and was not used or touched |
| Docker | **not installed** — no `docker`/`docker-compose` on `PATH`, no `Docker Desktop.exe` or `resources\bin\docker.exe`, no docker service or process, WSL reports no installed distributions, no `podman` |
| Project path | `C:\Users\Admin\Desktop\AI IT Helpdesk\opspilot-ai` (contains a space — deliberately exercised) |
| Git commit at validation | `cfb82e3` plus the working-tree changes listed under "Changes made" |
| Version | `package.json` 2.0.0-rc.1 |

## Windows startup

### First run — PASS

`start.bat` launched from its own folder with the output captured. Observed, in order: the Node 24
check passed; `Settings are valid: NODE_ENV=development, database at 127.0.0.1:5433, origin
http://localhost:5173, AI mock, mail disabled`; `Starting with: npm.cmd run dev:local`; `Local
PostgreSQL is running on 127.0.0.1:5433`; the API logged `listening` on 3001; Vite served 5173;
`OpsPilot is up at http://localhost:5173`. Paths containing a space were handled throughout.

Verified against the running instance: `/api/health/live` 200; `/api/health/ready`
`{"status":"ready","checks":{"notShuttingDown":"ok","database":"ok","migrations":"ok"}}`; web root
200; employee and engineer sign-in 200; wrong password 401; `/api/auth/me` 200;
`/api/operations/summary`, `/api/analytics`, `/api/reports/tickets` 200 for the engineer; the same
analytics call **403** for the employee; no cookie → 401. Listeners present on 3001, 5173 and 5433.
Database: 9 migrations applied, 0 pending.

### Second run — PASS

Stopped, then launched again through the Windows shell (`ShellExecute`, the same path a double-click
takes). The API came back healthy and the row counts were **identical** before and after —
User 14, Ticket 20, Reply 11, Event 34, Asset 28, Department 5, Approval 2, Survey 5, Outbox 52 —
with migrations still `applied=9 pending=0`. No reset, no duplicated demo data, no re-migration. The
cluster had been stopped abruptly by the test; PostgreSQL performed crash recovery and the second
run proceeded normally.

### Preflight failure — PASS

With `DATABASE_URL` pointed at `opspilot_rc_missing` (a database that does not exist) while the
server was up:

```
Settings are valid: NODE_ENV=development, database at 127.0.0.1:5433, …
Cannot reach the database: database "opspilot_rc_missing" does not exist on 127.0.0.1:5433 —
create it, or fix DATABASE_URL.
  The database could not be used. See the message above. … Nothing was changed.
START_BAT_EXITCODE=10
```

`opspilot_rc_missing` was **not created** (`DATABASES opspilot,opspilot_e2e_test,opspilot_test`),
nothing listened on 3001 or 5173, and `.env` was restored byte-for-byte from the backup taken before
the test. A scan of every captured console log for the values of `DEMO_PASSWORD`, `APP_SECRET` and
the database password found **none of them**.

### Result — WINDOWS START.BAT: PASS

## Docker

**NOT EXECUTED — Docker is not installed on this host, and the release owner elected not to use
Docker for this validation.** Nothing about the container path was tested here, and nothing about it
is claimed. What remains unverified: image build, the `migrate` job, container health, the smoke
workflow through the stack, SSE through Caddy, stop/start with volumes preserved, graceful shutdown
inside a container, and upload persistence across container recreation.

To close these rows on a machine with Docker:

```
copy .env.production.example .env.production   # fill DOMAIN, ACME_EMAIL, POSTGRES_PASSWORD, APP_SECRET
npm run doctor:prod
docker compose -f compose.prod.yaml --env-file .env.production up -d --build
docker compose -f compose.prod.yaml ps                 # app must be healthy; migrate exited 0
# smoke: sign in, open My Space / Command Center / Service Desk, reply on a ticket, check SSE
docker compose -f compose.prod.yaml up -d --force-recreate app   # then download the attachment again
docker compose -f compose.prod.yaml stop app           # expect exit 0 and a clean shutdown log
```

### Result — DOCKER PRODUCTION STACK: NOT EXECUTED

## Upload persistence

| | |
| --- | --- |
| Ticket | #67 (`a08604a4-58f3-48bc-b136-13221114260e`), created through the API as the employee |
| Attachment | `rc1-upload-persistence.txt`, 44 bytes, id `46a53676-4d03-4ac8-bbfb-e6397d477d7c` |
| Stored as | `uploads\a08604a4-…\558f3e9000654bff2755bf8e9266def8.txt` (44 bytes on disk) |
| sha256 | `130bca7ff0759871ca9c57f71dea64aae6f50ec1cc934460afbc50728ccdc85b` |

Before: upload 201, download 200 with `Content-Disposition: attachment; filename="rc1-upload-persistence.txt"`,
bytes identical to the original. The application was then **stopped and started again** (the
database left running): the ticket reloaded with its attachment, the download returned 44 bytes with
the same sha256, `IDENTICAL_TO_BEFORE=true`.

That proves the bytes live in `UPLOAD_DIR` and survive an application restart. It does **not** prove
the checklist's row 17, which requires the file to survive recreation of the application *container*
with the `uploads` volume preserved. That needs Docker and was not executed.

### Result — UPLOADS ACROSS APPLICATION-CONTAINER RECREATION: NOT EXECUTED (application restart: PASS)

## Issues found

**P0** — none.

**P1**

1. **The local database cluster was created in the machine's locale (WIN1252), so ticket updates
   failed with HTTP 500.** Audit details contain `→`; PostgreSQL rejected them with SQLSTATE 22P05.
   30 of 362 API tests failed on this host for that single reason. Fixed: new clusters are created
   as UTF-8 with the C locale, and startup now refuses a non-UTF-8 database with the remedy instead
   of failing later. See RC1-CHANGES #18.
2. **`npm run db:backup` could not run on a path containing a space** — the documented Windows
   layout. The scripts spawned `tar`/`pg_dump` through a shell, which concatenates arguments without
   quoting. Fixed; a backup of the live cluster (84.5 MB) was then taken successfully. RC1-CHANGES #19.

**P2**

3. `scripts/local-db.mjs` reported "Local PostgreSQL is running" when the postmaster had exited
   during crash recovery. It now confirms the port accepts connections first. RC1-CHANGES #20.

**P3**

4. `start.bat` exit-10 wording, CRLF line endings, and `npx tsx server/preflight.ts` not loading
   `.env` when run directly as the runbook documents. All three fixed. RC1-CHANGES #21.
5. Node prints `DEP0190` deprecation warnings (spawning with `shell: true`) during startup. Cosmetic;
   the shell spawns that mattered were removed in fix 2, the rest are in launcher plumbing.

## Changes made

Code and scripts: `scripts/local-db.mjs` (UTF-8 cluster creation; port verification),
`server/preflight.ts` (encoding check, `.env` for the CLI), `scripts/backup.mjs`,
`scripts/restore.mjs` (no shell, so spaces in paths survive), `start.bat` (wording, CRLF),
`tests/preflight.test.ts` (new, 2 tests).

Documentation: this file, `docs/RC1-CHANGES.md` (#18–#21), `docs/OPERATIONS-RUNBOOK.md` (§4a database
encoding, two new startup-error rows), `docs/SETUP.md` (UTF-8 note), `docs/RELEASE-CHECKLIST.md`
(rows 13–17 and a new encoding row).

Host state after validation: the local database was recreated as UTF-8 **with the owner's explicit
consent**, after a backup was taken to `backups\opspilot-localdb-2026-09-20T05-18-49.tar` (84.5 MB,
the previous WIN1252 cluster). The demo story was re-seeded and is now complete — 14 people, 20
tickets, 28 assets, 11 knowledge articles (the previous database had 0), 5 departments, 2 approvals,
5 ratings. Ticket #67 and its attachment from the upload test remain; `npm run demo:reset` clears them.

## Verification after the changes

| Check | Release host (Windows) | Linux sandbox |
| --- | --- | --- |
| `tsc --noEmit` | clean | clean |
| `npm run build` | clean — JS 501.67 kB (138.08 kB gzip), CSS 189.94 kB (31.73 kB gzip) | same artefacts |
| `npm test` | **364 passed / 0 failed, 23 files** (was 332/30 before the fix) | **364 passed / 0 failed, 23 files** |
| `npm run test:e2e` | **35 passed / 0 failed** (2.3 min) | **35 passed / 0 failed** (2.5 min) |
| `npm audit --audit-level=high` | 0 vulnerabilities | 0 vulnerabilities |
| Accessibility | not re-run — no interface code changed in this phase | 18 RC states, 0 violations (previous run) |
| Backup / restore | backup on the release host: PASS (84.5 MB); restore path unchanged since the earlier file-level test | file-level backup→restore round trip: PASS |

## Final decision

# NOT READY FOR RC1

Windows startup passes on the release host, and the code now passes its full suites there — but two
of the three blocking rows (Docker production stack, uploads across container recreation) were not
executed, because Docker is not installed and the owner chose not to use it. The brief's criteria
for declaring RC1 require all three. No tag was created.

Two ways forward, both the owner's call:

1. Run the Docker rows on a machine that has Docker (commands above), then tag.
2. Re-scope RC1 to the non-container deployment. That is a deliberate decision to make and record:
   rows 15 and 17 would be marked out of scope, and `docs/DEPLOYMENT.md` would have to state that the
   container path ships unverified.
