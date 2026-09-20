# Release checklist

Three sections, in order of how much they can be trusted. Nothing appears under **Verified** unless
it was executed in this session and the output was observed.

**Environment for every result below:** Node **24.21.0**, npm 11.7.0, PostgreSQL **18.4**
(`embedded-postgres`, the same server `npm run setup` falls back to), Chromium headless shell
153.0.8010.12 via Playwright 1.63.0, Linux x86-64. Installed with `npm ci` from the committed
lockfile into a clean copy of the source with no `node_modules`, `dist`, generated Prisma client or
`.env`. Earlier phases were validated on PostgreSQL 17.4; rows 1–22 were re-run on 18.4.

---

## Verified — executed, output observed

| # | Check | Command | Result |
| --- | --- | --- | --- |
| 1 | Locked install from a clean copy | `npm ci` | Passed |
| 2 | Prisma client generation | `npm run db:generate` | Passed, Prisma 7.10.0 |
| 3 | All eight migrations on an empty database, and the eighth on populated ones | `npm run db:migrate` | Passed, applied in order; no existing row touched |
| 4 | Guarded fictional seed | `npm run db:seed` | 4 accounts, 6 tickets, 11 assets, 7 articles |
| 5 | Retrieval index build | `npm run ai:reindex` | 6 published articles indexed, 0 failed |
| 6 | Environment doctor | `npm run doctor` | No problems |
| 7 | TypeScript, both projects, and optimized build | `npm run build` | Passed, 0 errors |
| 8 | Unit and real-PostgreSQL API suites | `npm test` | **308 tests across 17 files, all passed** |
| 9 | Knowledge evaluation, deterministic mock | included in `npm test` | **18/18 matched — development 11/11, held-out 7/7.** All behavioural release criteria met |
| 10 | Chromium end-to-end | `npm run test:e2e` | **28 tests, all passed, three consecutive runs** |
| 11 | Dependency audit | `npm audit --audit-level=high` | 0 vulnerabilities |
| 12 | Retrieval latency benchmark | `npm run bench:retrieval` | Measured at 256 and 1536 dimensions across 10–1000 articles — see [RETRIEVAL.md](RETRIEVAL.md) |
| 13 | Retrieval optimisation, before and after | same benchmark, same corpus | **13.6× faster**; 1,666 ms → 122.6 ms at 800 passages |
| 14 | Destructive-write guard: application database | `TEST_DATABASE_URL=<app db> npm test` | Refused |
| 15 | Destructive-write guard: populated database named `_test` | purpose-built fixture | Refused, naming the non-demo accounts it found |
| 16 | Destructive-write guard: empty database | purpose-built fixture | Claimed and proceeded |
| 17 | Explicit claim command | `npm run db:claim-test` and `-- --confirm` | Dry run changed nothing; confirmed run claimed both |
| 18 | Fresh-install path end to end | all of the above on new databases | Passed |
| 19 | Upgrade from a populated Phase 2 database | migrations 1–4, populate, then 5 | All rows preserved; internal note text byte-identical |
| 20 | UX audit, 7 routes × 2 viewports × 3 roles | scripted DOM audit | No unnamed controls, no page overflow, one `h1` per page |
| 21 | AI failure states in the browser | `npm run test:e2e` | Timeout, outage, usage limit, loading and recovery each assert distinct messaging |
| 22 | Screenshots | captured from the running app | 10 captured and visually reviewed |
| 23 | One-command setup, no `.env`, no database of any kind | `npm run setup` | Downloaded and started PostgreSQL 18.4, created 3 databases, migrated, seeded, indexed |
| 24 | Same, from a `.env` with 6 of 27 keys pointing at a dead port | `npm run setup` | Kept all 6 values, added the 21 missing, repointed the URLs, backed the old file up |
| 25 | Same, with a correct `.env` and a database already running | `npm run setup` | Adopted the running server, changed nothing it did not need to |
| 26 | Re-running setup on a working install | `npm run setup` ×3 | Idempotent; refuses to re-seed a database holding non-demo accounts |
| 27 | Application actually runs | `npm run dev:local` | Vite 200, `/api/health` ok through the proxy and direct, login returned a session and CSRF token |
| 28 | Stale `postmaster.pid` after a killed terminal | kill -9, then `npm run setup` | Lock cleared automatically after confirming the process was gone |
| 29 | Evaluation corpus precondition | orphan articles injected | Leftovers from an interrupted run cleaned automatically; a foreign published article refused with a named cause |
| 30 | Empty setting in `.env` (`OPENAI_API_KEY=`) | `npm test`, `npm run dev` | Treated as unset instead of a Zod stack trace |
| 32 | Account security end to end | `npm test`, `npm run test:e2e` | Lockout, TOTP with RFC 6238 vectors and replay refusal, recovery codes, forced change, reset links, session revocation — API and browser |
| 33 | Permission matrix | `npm test` | 107 endpoints × 3 roles + anonymous; a route missing from the matrix fails the suite |
| 37 | Service-desk workspace | `npm test`, `npm run test:e2e` | Board and drag-and-drop, catalog forms and approvals, followers, mentions, attachments (allow-list, magic bytes, download-only), reply editing, ratings, departments and directory, announcements, palette, notification centre, reports |
| 34 | Governance | `npm test` | Audit export, data export, erasure, retention — all audited, all admin-gated |
| 35 | Operations surface | `npm test` | Probes, request ids, metrics gating and series, content-free request logs |
| 36 | Production pre-flight | `npm run doctor:prod` | Refuses the example, accepts a filled-in file |
| 31 | **The delivered ZIP itself** — extracted into an empty folder, no `node_modules`, no `.env` | `npm run setup` then `npm run dev:local` | Installed, downloaded PostgreSQL 18.4, migrated, seeded, indexed, served; all four seeded accounts signed in; Ask AI returned a cited answer |

### What the numbers mean

- **132 / 20 / 18-18** are counts of tests that passed with the **deterministic mock** AI provider.
  They demonstrate the application's permissions, validation and abstention wiring.
- **18/18 means "passed these eighteen cases with this provider".** It is not a measure of AI safety,
  and says nothing about a real model's answer quality. See [EVALUATION.md](EVALUATION.md).

---

## Implemented but unverified — code exists, never executed here

| Area | Why not verified | How to verify | Command |
| --- | --- | --- | --- |
| **Real OpenAI provider calls** | No API key used; no request has ever been sent to OpenAI from this project. Making paid calls was not authorised | Provide your own key and run the evaluation set | `$env:AI_MODE='openai'; $env:OPENAI_API_KEY='<key>'; npm.cmd run eval:real` |
| **Docker Compose runtime** | Docker unavailable in every environment this project has been validated in | Scripted, one command | `npm.cmd run verify:containers` |
| **The pinned `pgvector/pgvector:pg18` image** | Docker unavailable. PostgreSQL **18.4 itself is now verified** — every suite above ran on it — but that was the embedded server, not this image | Covered by the container script | `npm.cmd run verify:containers` |
| **Mailpit SMTP delivery and capture** | Same. A local SMTP sink was used in Phase 2, which is **not** the same as verifying Mailpit | Covered by the container script, which reads the message back through Mailpit's own API | `npm.cmd run verify:containers` |
| **Service restart and fresh-volume install in containers** | Same | Covered by the container script | `npm.cmd run verify:containers` |
| **pgvector code path** | The extension has never been installed here. **The schema is not index-ready** — `embedding` is `double precision[]` and pgvector needs a `vector` column | Would require the migration described in [RETRIEVAL.md](RETRIEVAL.md), then re-benchmarking | — |
| **GitHub-hosted CI** | Defined in `.github/workflows/ci.yml`, never run remotely | Push the repository and read the Actions run | — |
| **Windows / PowerShell specifically** | All commands were executed on Linux. The documented commands are PowerShell equivalents. `setup` and `db:local` branch on `process.platform` for `npm.cmd` and shell quoting, and the embedded server publishes a `windows-x64` build, but neither has been run on Windows here | Follow [SETUP.md](SETUP.md) on your machine | `npm.cmd run setup` |

| **Production image, compose.prod.yaml, Caddy TLS** | Docker unavailable; written, reviewed, built and booted only by the CI `image` job definition | First real deployment | `npm.cmd run doctor:prod`, then `docker compose -f compose.prod.yaml --env-file .env.production up -d --build` |
| **Backup via pg_dump** | No client tools here; only the file-level path for the self-contained database ran | Where pg_dump exists | `npm.cmd run db:backup` |
| **Emailed reset links** | Mailpit never ran here; the token path is tested, the SMTP hand-off is not | With the mailpit container | *Forgotten your password?* |
| **Attachment volume in production** | `compose.prod.yaml` mounts `uploads` for the read-only container; never run | First real deployment | see DEPLOYMENT.md |

**Do these two first if you want the strongest release story:** `verify:containers` closes six rows
at once, and `eval:real` is the only thing that can say anything about real model behaviour.

---

## Deferred — deliberately not built

| Item | Why |
| --- | --- |
| Persisted AI answer history | Stored answers outlive the permissions of their sources unless revocation is implemented. Nothing about an answer is kept |
| pgvector index-backed ranking | Exact ranking is measured as adequate to ~100–200 articles at production embedding width. The crossover and the required migration are documented rather than guessed |
| Related resolved tickets | Needs permission-scoped retrieval over ticket bodies plus a decision on cross-assignment visibility |
| Attachments | Requires authorization, private storage, type and size limits, safe download handling and a malware-scanning decision before any upload endpoint exists |
| Business-hours SLA calendars | The 24/7 clock is documented and tested; calendars are a separate design problem |
| SSO (SAML/OIDC), passkeys | MFA, password reset and role editing arrived in Phase 5; federation is a separate integration project |
| Multi-instance rate-limit store | The limiter and metrics are process-local; lockout counters are in the database and shared. Correct for one instance, documented for more |
| Full WCAG audit | Accessibility verification is limited to what the browser tests assert |
| Cloud deployment and Terraform | Explicitly out of scope. No resources provisioned, no costs incurred |

---

## Known limitations to state when presenting

1. **No real model has been evaluated.** The OpenAI client is verified against a stubbed transport,
   which proves protocol conformance and nothing about quality.
2. **Prompt injection is mitigated, not solved.** The tested attacks were contained. The controls
   that hold are structural — no tools, permission filtering before retrieval, citation
   revalidation, human approval — not prompt wording.
3. **Redaction is best-effort** pattern matching and will miss unusual secret formats.
4. **Hallucination is constrained, not eliminated.** Answers are limited to retrieved passages and
   cite them, which makes a wrong answer checkable rather than impossible.
5. **No users, no production data, no deployment.** Everything is fictional seed data.

---

## Remaining commands, in order

```powershell
# 1. Set your machine up, then confirm it
npm.cmd run setup
npm.cmd run doctor

# 2. Reproduce the verified rows on Windows with Node 24
npm.cmd run build
npm.cmd test
npx.cmd playwright install chromium
npm.cmd run test:e2e
npm.cmd audit --audit-level=high

# 3. Close the container rows (needs Docker Desktop running)
npm.cmd run verify:containers

# 4. Optional: measure retrieval on your hardware
docker compose exec db createdb -U opspilot opspilot_bench
$env:BENCH_DATABASE_URL = 'postgresql://opspilot:local-only-db-password@localhost:5433/opspilot_bench'
npx.cmd prisma migrate deploy
npm.cmd run bench:retrieval

# 5. Optional: evaluate a real provider — costs money, your key
$env:AI_MODE = 'openai'
$env:OPENAI_API_KEY = '<your key>'
npm.cmd run eval:real
```

Record whatever you run in [VALIDATION.md](VALIDATION.md), moving rows from **Implemented but
unverified** into **Verified** with the actual output. Do not move a row without running it.
