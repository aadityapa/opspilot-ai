# RC1 change control

Every meaningful change of the release-candidate hardening phase: the problem, its risk grade, the
fix, the test that holds it, and the files. Grades: P0 data loss / auth bypass; P1 major failure or
broken key workflow; P2 important, releasable with a workaround; P3 polish. Nothing here adds
product surface. No schema migration was made.

## Fixed

### 1. Two approvers deciding the same approval at once both succeeded — P1
**Problem.** `POST /tickets/:id/approvals/:approvalId/decide` read the approval, checked
`PENDING`, and updated it without serialising against a concurrent decision; two requests in the
same instant both got 200 and the last write won (an APPROVED request could end REJECTED and
resolved). **Fix.** The transaction now takes the ticket row lock (`SELECT … FOR UPDATE`) first,
the same pattern replies, updates and reopen already used; the second decision sees the decided
row and gets 409. **Test.** `tests/rc-reliability.test.ts` "an approval can be decided once".
**Files.** `server/workspace.ts`.

### 2. CSV exports could carry live spreadsheet formulas — P2
**Problem.** A ticket title, audit detail or comment beginning with `=`, `+`, `-`, `@`, tab or CR
was written verbatim; opened in a spreadsheet it executes (`=HYPERLINK`, DDE). **Fix.** One encoder
(`server/csv.ts`) prefixes such cells with a single quote — the OWASP mitigation — while leaving
plain numbers numeric; both the report export and the audit export use it. **Test.**
`tests/rc-security.test.ts` "CSV exports" (unit and both endpoints). **Files.** `server/csv.ts`
(new), `server/reports.ts`, `server/governance.ts`.

### 3. A typo in `DATABASE_URL` created an empty database and started the application on it — P2
**Problem.** `prisma migrate deploy` creates a missing database; a wrong name produced a fresh
schema and an application with no data, the worst way to discover a misconfiguration. **Fix.** A
preflight (`server/preflight.ts`) categorises connection failures — nothing answering, wrong
password, database missing — without repeating the URL, and refuses (exit 10) before any migration
runs: in the container entrypoint, the compose `migrate` job, `upgrade-db.mjs` and the server's own
start (bounded wait: ten attempts for a database still booting; immediate stop for credentials or
a missing database). **Test.** Exercised by hand for all four categories (see RC-AUDIT §4 results);
`tests/rc-security.test.ts` unchanged paths. **Files.** `server/preflight.ts` (new),
`server/index.ts`, `scripts/upgrade-db.mjs`, `docker/entrypoint.sh`, `compose.prod.yaml`.

### 4. Session expiry discarded the page — P2
**Problem.** Any 401 during work set `user = null`, unmounting the workspace and every draft.
**Fix.** `api()` raises a window event on 401 (except sign-in/`me`/logout); the shell shows an
in-place "Your session has ended" dialog with the password field, focus-trapped, keeping the page
mounted; success updates the CSRF token and refetches; a different account or a second factor
reloads the application; Escape keeps the page and asks again on the next action. **Test.**
`tests/e2e/resilience.spec.ts` "an expired session asks for the password in place"; RC a11y sweep
(dialog, focus trap). **Files.** `web/api.ts`, `web/main.tsx`, `web/ui/index.tsx` (focus trap for
every Modal and Drawer).

### 5. Network loss and non-JSON gateway answers surfaced as raw errors — P2
**Problem.** `fetch` rejection showed "Failed to fetch"; a proxy 502 HTML page threw a JSON parse
error. **Fix.** `api()` maps a failed fetch to status 0 with a plain sentence that says the work is
kept, and non-JSON bodies to a readable message by status. **Test.** `tests/e2e/resilience.spec.ts`
"a network loss keeps the draft… retry sends exactly one reply". **Files.** `web/api.ts`.

### 6. Graceful shutdown never completed while a live-update stream was open — P2
**Problem.** SSE responses never end; `server.close()` waited for them, so every stop with a tab open
hit the 10 s deadline and exited 1. **Fix.** Open streams are tracked; shutdown sends `event: bye`
and ends them before closing the server (browsers reconnect within 5 s). **Measured.** SIGTERM with
one open stream → exit 0 in 44 ms. **Files.** `server/realtime.ts`, `server/index.ts`.

### 7. Database outage answered 500 "Something went wrong" — P2
**Problem.** Connection-level failures were indistinguishable from bugs; the interface could not
say "try again". **Fix.** Prisma initialisation/connection errors and driver socket errors map to
`503` with `Retry-After: 5` and a sentence saying nothing was changed; readiness already reported
503. **Measured.** Outage and recovery mid-run without restart. **Files.** `server/app.ts`.

### 8. Service Intelligence took 4.4 s at 10k tickets / 365 days — P2
**Problem.** The per-day series scanned every ticket for every day (O(days × tickets)) and the query
read every ticket ever. **Fix.** Tickets are bucketed once by created/resolved/breached day and the
backlog is a running count over sorted timestamps; the query is bounded to rows that can affect
either period (`resolvedAt IS NULL OR resolvedAt ≥ previousFrom`). Same for the Command Center's
`/operations/summary` per-day flow. **Measured.** analytics 365 d 4.36 s → 0.58 s, 30 d 0.79 s →
0.15 s; operations summary 0.53 s → 0.06 s. **Test.** `tests/intelligence.test.ts` and
`tests/operations-summary.test.ts` unchanged and passing (semantics preserved). **Files.**
`server/analytics.ts`, `server/operations.ts`.

### 9. Report JSON returned every row (3.8 MB for a year at scale) — P2
**Fix.** `rows` capped at 2,000 with `truncated: true` and the real `total`; the CSV is never
capped; the footer says so. **Files.** `server/reports.ts`, `shared/model.ts`, `web/reports.tsx`.

### 10. zod (80 kB) shipped in the browser bundle by accident — P3
**Problem.** `web/assets.tsx` imported two constant arrays from `shared/operations.ts`, which
imports zod. **Fix.** The arrays live in `shared/model.ts`. **Measured.** main chunk 580.42 kB →
501.67 kB (160.55 → 138.08 kB gzip). **Files.** `shared/model.ts`, `shared/operations.ts`,
`web/assets.tsx`.

### 11. Backup and restore exposed the database password in the process list — P2
**Fix.** `pg_dump`/`pg_restore` receive the password through `PGPASSWORD`; the URL on the command
line has it stripped. **Files.** `scripts/backup.mjs`, `scripts/restore.mjs`.

### 12. Date-only values could show the previous day west of UTC — P3
**Problem.** Purchase and warranty dates are stored as UTC midnight and were formatted in the
viewer's zone. **Fix.** `fmtCalendarDay` formats calendar dates in UTC; timestamps keep local
formatting. **Files.** `web/ui/index.tsx`, `web/assets.tsx`.

### 13. Two SLA presentation functions existed in the client — P3
**Fix.** The unused `slaState`/`SlaIndicator`/`fmtDuration` in `web/ui/index.tsx` were removed;
`ui/marks.tsx` `slaSummary` is the one reading of the server's `slaView`, and `slaPosition` is the
one live definition on the server (asserted at its boundaries with an injected clock in
`tests/rc-reliability.test.ts`). **Files.** `web/ui/index.tsx`.

### 14. Rate limits on the expensive endpoints — P2 (hardening)
**Change.** `server/limits.ts`: search 120/min; analytics, reports, audit export and the legacy
dashboard 60/min; uploads 60/15 min — per source address, standard `RateLimit-*` headers, ×100
under the test runner. Ordinary ticket operations are not limited. **Test.**
`tests/rc-security.test.ts` "rate-limits the expensive endpoints". **Files.** `server/limits.ts`
(new), `server/workspace.ts`, `server/analytics.ts`, `server/reports.ts`, `server/governance.ts`,
`server/app.ts`.

### 15. Configuration failures were stack traces — P3
**Fix.** `server/config.ts` prints one JSON line naming the setting (never its value) and exits 12;
`scripts/validate-env.ts` does the same before `start.mjs` launches anything; `start.bat` explains
exit codes 10/11/12; `setup.mjs` refuses to substitute a local database when `.env` names a remote
host that is not answering. **Files.** `server/config.ts`, `scripts/validate-env.ts` (new),
`scripts/start.mjs`, `scripts/dev-local.mjs`, `start.bat`, `scripts/setup.mjs`, `.env.example`.

### 16. Browser tests accumulated state between runs — P2 (tests)
**Problem.** The reused e2e database gathered accounts, tickets, articles and 130+ unread
notifications across runs; tests were order- and history-dependent. **Fix.** `scripts/e2e-reset.ts`
truncates every application table (keeping migrations and the SLA policy defaults) before the seed,
so each run starts from exactly the demo story. One test that relied on inventory ordering now
finds its asset by search (`tests/e2e/operations.spec.ts`), an intentional and documented test
change. **Result.** 35/35 on three consecutive full runs. **Files.** `scripts/e2e-reset.ts`,
`scripts/e2e.mjs`, `tests/e2e/operations.spec.ts`.

### 17. Structured worker logging — P3
**Fix.** The notifications worker logs a JSON warn line with the error name instead of a bare
`console.error`. **Files.** `server/notifications.ts`.

## Found and fixed during host validation (2026-09-20, Windows 10 Pro 19045)

### 18. The local database was created in the machine's locale, so ticket updates failed — P1
**Problem.** `scripts/local-db.mjs` created the embedded cluster without an encoding, so initdb took
it from the operating system's locale: **WIN1252** on this host. The application writes UTF-8 —
every audit detail reads `status: OPEN → RESOLVED` — and PostgreSQL rejected those writes with
SQLSTATE 22P05 (`character with byte sequence 0xe2 0x86 0x92 … has no equivalent in WIN1252`). Any
ticket update, board move, approval decision, bulk action or applied AI suggestion answered HTTP
500. The API suite showed it plainly on the host: **30 of 362 tests failed**, all on those paths.
Linux was unaffected because its locale yields UTF-8, which is why five phases of green runs never
caught it. **Fix.** (a) New clusters are created with `--encoding=UTF8 --locale=C`, deterministic on
every machine. (b) `server/preflight.ts` reads `server_encoding` and refuses to start on anything
but UTF-8, naming the encoding and the remedy — so an existing wrongly-encoded cluster fails fast at
startup instead of 500-ing hours later. The check runs on every path: `start.bat`, `dev:local`, the
container entrypoint, the compose `migrate` job. **Tests.** `tests/preflight.test.ts` (2 cases) pins
the rule; the host suite went from 332/362 to **364/364** after the cluster was recreated.
**Files.** `scripts/local-db.mjs`, `server/preflight.ts`, `tests/preflight.test.ts`, docs.

### 19. `npm run db:backup` failed on any path containing a space — P1 for operations
**Problem.** The backup and restore scripts spawned `tar`, `pg_dump`, `pg_restore` and `docker` with
`shell: true` on Windows, where Node concatenates arguments without quoting. The documented Windows
layout is `…\AI IT Helpdesk\opspilot-ai`, so the target path was split and the backup died with
`tar: Couldn't visit directory` and a misleading `Permission denied`. No backup could be taken on the
documented install path. It passed in the earlier phase only because that sandbox path had no
spaces. **Fix.** Those spawns no longer use a shell; the executables are launched directly, so
arguments are passed verbatim. **Verified.** `npm run db:backup` on the release host produced an
84.5 MB archive of the live cluster. **Files.** `scripts/backup.mjs`, `scripts/restore.mjs`.

### 20. The local database reported "running" when the postmaster had not come up — P2
**Problem.** `embedded-postgres` resolves once it has spawned PostgreSQL. After an unclean stop the
postmaster can exit during crash recovery; the script still printed "Local PostgreSQL is running"
and the next step failed with ECONNREFUSED. **Fix.** `startLocalDatabase` now polls the port and
only reports success when connections are accepted; otherwise it throws with the last server lines
and the `pg_ctl` recovery recipe. **Files.** `scripts/local-db.mjs`, runbook §8.

### 21. Launcher polish found while running it — P3
`start.bat` said "The database did not answer" for exit 10, which now also covers "the database is
there but cannot be used"; it reads "The database could not be used. See the message above." The
file was also normalised to CRLF, the Windows convention for a shipped launcher, and
`server/preflight.ts` run directly (`npx tsx server/preflight.ts`, as the runbook documents) now
loads `.env` instead of reporting "DATABASE_URL is not a valid URL".
**Files.** `start.bat`, `server/preflight.ts`.

## Added without a code defect behind it

- `scripts/perf-dataset.ts` (`npm run perf:dataset`): synthetic scale data into a `_perf_test`
  database only.
- `scripts/demo-reset.ts` (`npm run demo:reset`): guarded full reset of the demo workspace.
- `tests/rc-security.test.ts` (18 tests), `tests/rc-reliability.test.ts` (6),
  `tests/e2e/resilience.spec.ts` (3).
- Documentation: `docs/RC-AUDIT.md`, `docs/SECURITY.md` (rewritten), `docs/OPERATIONS-RUNBOOK.md`,
  `docs/BACKUP-RESTORE.md`, `docs/DEMO-SCRIPT.md`, `docs/RELEASE-CHECKLIST.md` (rewritten),
  `docs/DEPLOYMENT.md` (proxy/SSE requirements, verification statement), `docs/API.md`,
  `docs/screenshots/rc/`.

## Test changes, all intentional

| Test | Change | Why |
| --- | --- | --- |
| `tests/e2e/operations.spec.ts` asset inventory | finds SWT-0001 through the search box (+Enter) instead of expecting it on the first page | with a freshly reset database the sorted inventory paginates before SWT-0001; the assertion is about scope, not page position |

No assertion was weakened and no test was deleted.

## Evaluated and left as is (P2/P3, documented)

- `GET /admin/users` returns every account (1.4 MB at 5,000 accounts, 20 ms server-side);
  administrator-only, filtered client-side. Server pagination would change the response shape;
  deferred with the limitation stated.
- `GET /api/board` takes the first 500 tickets without a total; documented in WORKSPACE.md.
- `qrcode` (22 kB) in the main chunk via the eagerly loaded account page; not worth the risk of
  lazy-loading the MFA path.
- Attachment upload writes the file before the row; a failed insert leaves an orphan file (harmless,
  not reclaimed). Documented in the runbook.
