# Production release checklist — OpsPilot V2

The gate for a native Windows production release. Every row is **PASS**, **FAIL**, **OUT OF SCOPE**
or **NOT EXECUTED** — never "probably", and never a result copied forward from an earlier phase
without saying so.

**Where each check ran matters**, so every row says:

- **Windows host** — the release target: Windows 10 Pro, native Node, the local PostgreSQL that
  `start.bat` starts, exercised through Chrome on that machine.
- **Verification environment** — the project's Linux environment running the same commit, the same
  seed and the same PostgreSQL 18 build. Good enough for logic, not a substitute for the Windows
  startup path.

Assessed on **20 September 2026** against commit `250d429` (`main`).

---

## Verdict

**NOT READY FOR PRODUCTION RELEASE.** No defect is open: every functional, security, reliability
and regression gate that could be executed passed. Two things block the tag:

1. **Five Windows-only gates could not be executed** (rows 4, 5, 6, 41, 42). The Windows session
   refuses synthetic input — mouse moves return `blocked by UIPI`, keystrokes return `no app is
   frontmost` — so no Command Prompt could be opened on the release machine and no `demo:reset`,
   `demo:check` or `start.bat` could be run there.
2. **The Git history was rewritten outside the release process** (row 48), which leaves the
   `v2.0.0-rc1` tag pointing at a commit that is no longer on `main`. The release lineage has to be
   settled by the repository owner before a production tag is placed on top of it.

Neither is a fault in the application.

---

## Git and release governance

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Branch, HEAD, clean tree | **PASS** | `main` at `250d429`, working tree clean, no unexpected modifications |
| 2 | Historical tags immutable | **PASS** | `v2.0.0-rc1` still resolves to `b7880dc`; nothing was moved, forced or deleted |
| 48 | Release lineage intact | **FAIL** | A `git filter-branch` rewrote every commit after the initial one to a single author identity. File trees are byte-identical (`git diff b7676c3 250d429` is empty), but `v2.0.0-rc1` now points at `b7880dc`, which is **not an ancestor of `main`**. `.git/refs/original/refs/heads/main` still holds the pre-rewrite tip `b7676c3`. Not done by the release process; needs an owner decision |
| 49 | Secret scan | **PASS** | No `.env`, backup, upload, `dist` or log file tracked; no secret-shaped literals in tracked source; the live `DEMO_PASSWORD` and `APP_SECRET` values appear in **no** committed object across all refs |
| 50 | `.env.example` complete, no real secret | **PASS** | Every key present in `.env` is present in `.env.example`; its values are URLs, model names and thresholds, no credentials |

## Runtime and startup

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 3 | Application reachable on the Windows host | **PASS** | Windows host: `/api/health/live` 200, `/api/health/ready` `{"status":"ready","checks":{"notShuttingDown":"ok","database":"ok","migrations":"ok"}}`, web served on 5173 |
| 4 | `start.bat` first run | **PASS** — 21 September 2026 | Windows host, launched through the shell the way a double-click does, from a cold machine with nothing listening on 3001, 5173 or 5433. Log captured: `Node 24 found` → `Settings are valid: NODE_ENV=development, database at 127.0.0.1:5433, origin http://localhost:5173, AI mock, mail disabled` → `Starting the local database…` → `Local database ready on 127.0.0.1:5433` → API `listening` on 3001 → Vite on 5173 → `OpsPilot is up at http://localhost:5173`. No credential appears anywhere in the output |
| 5 | Stop and restart on the Windows host | **NOT EXECUTED** | Same reason. Validated on this host in the RC1 phase: identical row counts before and after, no re-seed, no re-migration |
| 6 | Configuration failure is refused | **NOT EXECUTED on Windows** in this pass; **PASS** in the RC1 phase on this host (exit 10, no database created, no secret printed) |
| 7 | Production must fail fast on missing configuration | **PASS** | `server/config.ts` exits 12 naming the setting and never its value; `tests/preflight.test.ts` and the RC1 host run pin it |
| 8 | Production never auto-seeds demo data | **PASS** | `prisma/seed.ts` throws unless `NODE_ENV≠production` **and** `ALLOW_DEMO_SEED=true`; `scripts/demo-guard.ts` repeats the rule for the reset; both pinned by `tests/demo.test.ts` |

## Database

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 9 | Migrations apply from empty | **PASS** | Verification environment: 9 migrations applied to a fresh cluster, "All migrations have been successfully applied" |
| 10 | Migrations idempotent, no accidental reset | **PASS** | The browser harness re-applies on every run (2 runs this pass) with no data loss; live Windows readiness reports `migrations: ok` |
| 11 | UTF-8 encoding | **PASS** | Verification environment: `opspilot`, `opspilot_test`, `opspilot_e2e_test` all `UTF8`; restored cluster also `UTF8`. Startup refuses a non-UTF-8 cluster (`tests/preflight.test.ts`) |
| 12 | Backup | **PASS** | Verification environment: `opspilot-localdb-2026-09-20T13-16-38.tar`, 89,487,360 bytes (85.3 MB), exit 0, 585 ms. Refuses to run while the database is up, so the copy is consistent. No password on any command line. On Windows, under a path containing a space, an 84.5 MB backup succeeded in the RC1 phase |
| 13 | Restore, verified with real records | **PASS** | Backup extracted into an **isolated** cluster on port 5434 — the working cluster was never touched. Counts identical: User 14, Ticket 21, Reply 14, Approval 2, Article 11, Asset 28, Department 5, Survey 5, Event 31. All four personas present with correct roles; OPS-0001/0002/0003 by title; approvals PENDING 1 / APPROVED 1; encoding UTF8 |

## Security

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 14 | Authentication | **PASS** | Windows host: valid sign-in 200; the response body carries user, CSRF token and flags — **no password, hash or session token**. Unknown e-mail and wrong password both return 401 with the same sentence |
| 15 | Unauthenticated access refused | **PASS** | Windows host: protected API without a session → 401 |
| 16 | Role-based access | **PASS** | Windows host, as an employee: analytics 403, operations summary 403, reports 403, admin audit 403, admin users 403 |
| 17 | Object-level authorization / IDOR | **PASS** | Windows host, as an employee: own ticket 200; two other people's tickets **404** — indistinguishable from the 404 for a ticket id that does not exist, so existence is not disclosed |
| 18 | List scope | **PASS** | Windows host: the employee's ticket list returns only her 5 tickets; her article list returns only `EMPLOYEE`-visibility articles — no support runbooks |
| 19 | Knowledge visibility | **PASS** | Windows host: a `SUPPORT`-visibility runbook → 404 for the employee, the employee article → 200 |
| 20 | Search scope | **PASS** | Windows host: searching "laptop" as the employee returns 0 tickets (another person's laptop ticket is not surfaced), 2 employee articles, 1 service, 0 people, 0 assets, 0 departments |
| 21 | Attachment authorization | **PASS** | Verification environment: owner 200, engineer 200, **other employee 404**, unauthenticated 401, guessed id 404, path traversal 404 |
| 22 | Attachment delivery | **PASS** | `Content-Disposition: attachment; filename="probe.txt"`, `Content-Type: text/plain`, `X-Content-Type-Options: nosniff` |
| 23 | CSV formula injection | **PASS** | A ticket titled `=HYPERLINK("…","click me")` exports as `,"'=HYPERLINK(…` — prefixed with an apostrophe inside the quoted cell, the OWASP mitigation. Unit-pinned in `tests/rc-security.test.ts` |
| 24 | Rate limits | **PASS** | Windows host: a concurrent burst on search returned **429** with `Retry-After: 17` and `RateLimit` / `RateLimit-Policy` headers. Ordinary ticket operations are deliberately not limited |
| 25 | Security headers | **PASS (development configuration)** | Windows host: `content-security-policy: default-src 'self'; base-uri 'self'; …`, `x-content-type-options: nosniff`, `referrer-policy: no-referrer`, `x-frame-options: SAMEORIGIN`, `cross-origin-opener-policy`/`cross-origin-resource-policy: same-origin`, `x-permitted-cross-domain-policies: none`, `cache-control: no-store`. The instance runs in development mode, so the production-only posture (HSTS behind TLS) is **not** re-verified here; it is recorded in [SECURITY.md](SECURITY.md) |
| 26 | CORS | **PASS** | Windows host: `access-control-allow-origin: http://localhost:5173` — an explicit configured origin, never `*`, with `vary: Origin` |
| 27 | Error responses | **PASS** | Windows host: a malformed id returns `{"error":"Invalid request","issues":[…]}`; a database outage returns `{"error":"The database is not reachable right now. Nothing was changed — try again in a moment.","requestId":…}`. No stack, SQL, path, credential or environment value in any response body |
| 28 | Logging | **PASS** | Structured JSON with `ts`, `level`, `message`, `requestId`, `method`, `route`, `status`, `durationMs`, `ip`, `userId`, `userAgent`. No password, Authorization header, token or credential-bearing URL. Server-side error entries do contain stack traces with source paths — appropriate for a log, never sent to a client |

## Reliability

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 29 | Health and readiness distinguish state | **PASS** | With the database stopped: `/api/health/live` **200**, `/api/health/ready` **503** |
| 30 | Database outage handled safely | **PASS** | An authenticated request during the outage returned **503** with `Retry-After: 5` and a safe sentence; nothing leaked |
| 31 | Recovery without intervention | **PASS** | 200 again **1 second** after PostgreSQL returned, in the same process, with no restart |
| 32 | Graceful shutdown | **PASS** | SIGTERM with a live-update stream open: `event: bye` delivered to the client, log reads *shutting down → closed live-update streams (1) → stopped*, **exit code 0 in 26 ms** |
| 33 | Live updates (SSE) | **PASS** | Exercised by the browser suite in both runs (reconnect after an API restart, live update while typing with the draft preserved, shutdown with an open stream) |
| 34 | Network-failure UX | **PASS** | `tests/e2e/resilience.spec.ts`: the draft survives a failed send, the message explains what happened, and a retry sends exactly one reply |
| 35 | Concurrency | **PASS** | `tests/rc-reliability.test.ts`: an approval can be decided once (the second decision gets 409); ticket writes serialise on a row lock |
| 36 | SLA consistency | **PASS** | One server-side definition asserted at its boundaries with an injected clock; Command Center, Service Desk, workspace, analytics, reports and department demand all read it |
| 37 | Date and time | **PASS** | Calendar dates formatted in UTC so they cannot shift a day; timestamps local. Pinned by the suite |

## Persistence

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 38 | Database survives restart | **PASS** | RC1 phase on the Windows host: identical row counts across a stop/start. Verification environment this pass: unchanged across two restarts |
| 39 | Uploads survive restart, bytes identical | **PASS** | 61-byte attachment, sha256 `2fe0a9e8…c926ae` — identical to the original after **two** application restarts, served back with the right filename |

## Automated verification

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 40 | TypeScript | **PASS** | `tsc --noEmit` clean |
| 41 | Production build | **PASS** | JS **502.73 kB** (138.66 kB gzip), CSS **189.94 kB** (31.73 kB gzip) |
| 42 | Unit and API tests | **PASS** | Vitest **377 passed / 377**, 24 files, 47 s |
| 43 | Browser tests | **PASS** | Playwright **35/35**, then **35/35** again — two consecutive clean runs, no retries, 1.6 min each |
| 44 | Dependency audit | **PASS** | `npm audit --audit-level=high` → 0 vulnerabilities |
| 45 | Accessibility (WCAG 2.2 AA) | **PASS** | axe-core across 17 states — sign in, My Space, catalog, request form, knowledge, my requests, notifications, 403, 404, approvals, Command Center, Service Desk, Service Intelligence, reports, administration, audit log, ticket workspace — **0 violations** |
| 46 | Responsive | **PASS** | 360, 390, 1366 × 768 and 1920 × 1080 across 14 routes: **no horizontal overflow anywhere** |
| 47 | Performance smoke | **PASS (no regression observed)** | Windows host, median of 5: every endpoint — Command Center summary, Service Desk list, analytics 30 d, SLA report, people, assets, knowledge, audit — lands around 320 ms through the development proxy, with no outlier. The 10,000-ticket figures (lists 42 ms, analytics 0.58 s, summary 60 ms) are from the RC phase and were not re-measured |

## Native Windows demo

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 51 | `demo:reset` on Windows | **NOT EXECUTED** | Attempted 21 September from a real Windows console **before** the application was started, and it failed correctly: the local database was not running, so `db.user.count()` could not reach 127.0.0.1:5433 (exit 1, nothing changed). That is the documented order in the runbook being wrong, not the script — the runbook now says start first, reset second. The reset itself has still not been executed on this host |
| 52 | `demo:check` on Windows | **NOT EXECUTED** | Blocked behind row 51 |
| 53 | Final Windows walkthrough after the production checks | **NOT EXECUTED** in this pass | A complete walkthrough was performed on this host on 20 September 2026 in 10 min 54 s, every beat passing — [DEMO-RUNBOOK.md](DEMO-RUNBOOK.md), *Native Windows walkthrough* |
| 54 | Final clean reset | **NOT EXECUTED** | The Windows demo workspace is mid-story and needs `npm.cmd run demo:reset` before it is shown to anyone |

## Deployment scope

| # | Check | Result |
| --- | --- | --- |
| 55 | Native Windows | **Supported release target** |
| 56 | Docker / containers | **OUT OF SCOPE — UNVERIFIED.** Never built or run. [DEPLOYMENT.md](DEPLOYMENT.md) says so at the top and must keep saying so |

---

## Blockers

**P0** — none.

**P1**

1. **Release lineage broken by an external history rewrite.** `v2.0.0-rc1` is not an ancestor of
   `main`. Placing `v2.0.0` on this history would produce a release whose own release candidate is
   unreachable from it. Owner decision required: keep the rewritten history and re-tag the
   candidate, or restore the pre-rewrite tip preserved at `.git/refs/original/refs/heads/main`.
   Nothing should be forced or deleted until that decision is made.
2. **Five Windows-only gates unexecuted** (rows 4, 5, 6, 51, 52, 54). They need a Command Prompt on
   the release machine — two commands and one double-click, once the desktop accepts input.

**P2**

3. **The runbook told the operator to reset before starting.** On a machine that has just been
   switched on that cannot work — `start.bat` is what starts the local database, so `demo:reset`
   fails with "Can't reach database server at 127.0.0.1:5433". Found on Windows on 21 September by
   running the documented order. Fixed in [DEMO-RUNBOOK.md](DEMO-RUNBOOK.md): start first, reset
   second, check third. Documentation only; no script changed.

**P3**

- After signing out, Chrome leaves the last e-mail address in the sign-in field; clear it before an
  audience sees the first screen. Noted in the demo runbook.
- With the database down, `demo:reset` reports the failure as a raw Prisma stack trace rather than
  the one-sentence message `start.bat` gives for the same condition. Cosmetic, in a convenience
  script, and not worth a product change before release — but it is the reason the ordering mistake
  above read as alarming rather than obvious.

## Known limitations (unchanged, and all documented)

Docker deployment unverified and out of scope · no SSO, SCIM or IP allow-lists · no multi-level
approval chains · no advanced department routing · no business-hours SLA calendars · no scheduled
reports · no attachment preview · no full CMDB · the audit log is append-only by construction but
not cryptographically tamper-evident · rate limits and lockout counters are per process · live
updates assume a single application instance · the board reads the first 500 tickets · report
screens cap at 2,000 rows while the CSV export is never capped · AI runs as a deterministic offline
stand-in in this configuration and is labelled as such on screen.
