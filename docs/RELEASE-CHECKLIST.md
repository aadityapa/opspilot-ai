# Release checklist — v2.0.0-rc1

**Scope of v2.0.0-rc1: the native Windows/Node deployment.** The container path (rows 15 and 17) is
out of scope at the owner's direction and ships unverified — see
[RC1-HOST-VALIDATION.md](RC1-HOST-VALIDATION.md), "Scope decision for RC1".

Each row names the command, the result that counts as green, and the RC1 status. "Verified" means
executed in this hardening phase with the output observed; "inspected" means read but not run in
the verification environment (say so when presenting); "on your host" means the reader must run it
where the release will live.

| # | Check | How | Green when | RC1 |
| --- | --- | --- | --- | --- |
| 1 | Clean install | fresh copy, no `node_modules`, no `.env`, no database → `npm ci` → `npm run setup` | setup ends with "Ready"; four demo accounts listed | Verified (Linux, Node 24.13, embedded PostgreSQL 18) |
| 2 | Environment | `npm run doctor:prod` against `.env.production`; `npx tsx scripts/validate-env.ts` against `.env` | "Settings are valid" / no missing REQUIRED setting | Verified (valid and three invalid cases, exit 12) |
| 3 | Migration | `npm run db:migrate` on an empty DB, then again | 9 applied; second run "already up to date"; missing DB refused, not created | Verified |
| 4 | Seed | `npm run db:seed` twice; once with a non-demo account present; once with `NODE_ENV=production` | identical counts; "Refusing to overwrite a non-demo account"; production refused | Verified |
| 5 | Build | `npm run build` after deleting `dist/` | tsc clean; JS 501.67 kB (138.08 kB gzip), CSS 189.94 kB (31.73 kB gzip) | Verified |
| 6 | Unit / API tests | `npm test` | all files pass | Verified **on the release host (Windows 10 Pro, Node 24.16, 20 Sep 2026): 23 files, 364 tests, 0 failed**, and the same in the Linux sandbox |
| 7 | Browser tests | `npm run test:e2e` three times in a row | all pass, no retries | Verified: 35/35 on three consecutive Linux runs, and **35/35 on the release host (Windows)** |
| 8 | Accessibility | axe-core WCAG 2.2 AA on sign-in, My Space, catalog, request form, approvals, knowledge article, Command Center, Service Desk, ticket workspace, analytics, reports, administration, 403, 404, session-expired dialog, offline alert, palette | 0 violations | Verified: 18 states, 0 |
| 9 | Keyboard | sign in, palette, open ticket, reply, session dialog (focus trapped, Escape) without a mouse | no trap, visible focus | Verified in the same run |
| 10 | Mobile | 390 and 360: My Space, catalog, approvals, notifications, knowledge, assets, analytics, reports, admin, ticket reply, session dialog | `scrollWidth == viewport` | Verified |
| 11 | 1366 × 768 | Command Center, Service Desk, ticket workspace, analytics, reports, administration screenshots | no essential control below the fold | Verified (`docs/screenshots/rc/`) |
| 11a | Database encoding | `node dist/server/preflight.js` (or `npx tsx server/preflight.ts`) against the target database | reports `encoding: UTF8` and exits 0; a non-UTF-8 cluster is refused with the remedy | **PASS on the release host** after the WIN1252 cluster found there was recreated as UTF-8 (RC1-CHANGES #18) |
| 12 | `npm audit` | `npm audit --audit-level=high` | 0 vulnerabilities | Verified |
| 13 | Backup | `npm run db:backup` | file written, no password on the command line | Verified **on the release host** (84.5 MB archive of the live cluster, 20 Sep 2026) after fixing a quoting defect that broke any path containing a space (RC1-CHANGES #19); pg_dump path still inspected only |
| 14 | Restore | `npm run db:restore -- <file> --confirm`, then §Verify in BACKUP-RESTORE.md | counts and a marker row back to the backup | Verified (file-level path, Linux); the same quoting fix applies to `restore.mjs`, not re-run on the host |
| 15 | Docker production | see [DEPLOYMENT.md](DEPLOYMENT.md) | stack builds, migrates, serves, persists | **OUT OF SCOPE for RC1.** The release owner scoped this candidate to the native deployment and elected not to use Docker; the host has no container engine (checked twice, 20 Sep 2026). Not passed, not claimed — open for the first container release |
| 16 | Windows startup | `start.bat` from the folder and through the Windows shell; second run; a preflight failure | application reachable and signed into; second run neither resets nor duplicates data; failure exits 10, creates no database, prints no secret | **PASS on the release host, 20 Sep 2026** — evidence in [RC1-HOST-VALIDATION.md](RC1-HOST-VALIDATION.md) |
| 17 | Upload persistence across container recreation | part of 15 | same bytes after the app container is recreated with the volume kept | **OUT OF SCOPE for RC1** (needs Docker). Native equivalent **passed** on the host: ticket #67, `rc1-upload-persistence.txt` (44 bytes), application stopped and started, identical sha256 downloaded back |
| 18 | SSE | reconnect after API restart; live update while typing; shutdown with an open stream | draft/URL/tab intact; `event: bye` then reconnect; API exits 0 in < 1 s | Verified |
| 19 | Permissions | `npm test` (permissions matrix + `rc-security`) | every route documented; every object-level case refused | Verified |
| 20 | Security review | [SECURITY.md](SECURITY.md) read against the code; headers checked in production mode | matches | Verified (no external pentest) |
| 21 | Performance smoke | `npm run perf:dataset` into a `_perf_test` database (10k tickets, 5k people, 5k assets, 1k articles), then time the routes in [RC-AUDIT.md](RC-AUDIT.md) §8 | lists < 100 ms, analytics ≤ 1 s, summary < 100 ms | Verified: 42 ms / 0.58 s / 60 ms |
| 22 | Screenshots | `docs/screenshots/v2/p5-*.png` (final product), `docs/screenshots/rc/` (1366 + failure states) | present, current | Verified |
| 23 | Documentation | README, SETUP, API, PERMISSIONS, SECURITY, OPERATIONS-RUNBOOK, BACKUP-RESTORE, DEPLOYMENT, DEMO-SCRIPT, RC-AUDIT, RC1-CHANGES | match the code | Verified |
| 24 | Known limitations | README "Known limitations", SECURITY "Known security limitations", RC-AUDIT | stated, none faked | Verified |
| 25 | Version and tag | `package.json` 2.0.0-rc.1; tag after every in-scope row is green | | 2.0.0-rc.1; RC1 is scoped to the native deployment (rows 15 and 17 out of scope) |

The host validation of 20 September 2026 is recorded in
[RC1-HOST-VALIDATION.md](RC1-HOST-VALIDATION.md), including the two P1 defects it found and fixed.

## Before tagging on the release host

```
npm ci
npm run build
npm test
npm run test:e2e
npm audit --audit-level=high
git tag -a v2.0.0-rc1 -m "OpsPilot V2 release candidate 1"
```
