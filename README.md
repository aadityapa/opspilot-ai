# OpsPilot AI

An IT helpdesk and incident-management application for small and medium companies, with AI
assistance that a human always reviews.

**Status: a working application with a complete end-to-end workflow, account security, an operations
surface, a production deployment path and data governance — all tested. Not deployed anywhere, no
users, no production data.** It has the shape of a modern service desk — catalog, board, approvals, people, live notifications —
and runs a deterministic mock AI provider by default — no API key, no
network calls — and every AI feature can be switched off entirely without affecting anything else.

## The problem

A company of 50–200 people has IT requests arriving by email, chat and corridor conversation. Nothing
is tracked, priority is whoever asked most recently, and the same handful of questions gets answered
individually every week. Commercial helpdesks solve this, but are priced and shaped for larger
organisations.

## Who uses it

| User | What they need |
| --- | --- |
| **Employee** | Raise a request, see what is happening, and get an answer to a common question without waiting for a person |
| **IT engineer** | Triage and resolve efficiently, with internal notes, SLA visibility, and drafting help they control |
| **Administrator** | Manage accounts, hardware, service-level targets, the knowledge base, and see an audit trail |

## What it does

Ticketing with controlled status transitions, SLA timers on a 24/7 clock, asset inventory linked to
tickets, internal notes that never reach a requester, a permission-aware knowledge base, notifications
through a local mail sink, and dashboards computed from stored records.

On top of that: AI ticket triage the engineer approves before anything changes, conversation
summaries, reply drafts the engineer edits and sends themselves, and knowledge answers that cite the
passages they were built from — or say plainly that the evidence is insufficient.

**New here?** [docs/SETUP.md](docs/SETUP.md) is the complete Windows setup.
[docs/CASE-STUDY.md](docs/CASE-STUDY.md) covers the engineering decisions, the defects found, and the
measured results.

## Start here on Windows

You need **Node 24**. Nothing else.

**Double-click `start.bat`.** It checks Node, runs setup the first time, starts the application and
opens the browser. Leave the window open; Ctrl+C stops everything.

Or from PowerShell:

```powershell
node --version          # expect v24.x
npm.cmd run setup
npm.cmd run dev         # or npm.cmd run dev:local — setup tells you which
```

Open **http://localhost:5173** and sign in as `employee@opspilot.example`; the password is the
`DEMO_PASSWORD` line in the `.env` that setup wrote.

`setup` installs dependencies, repairs `.env` in place (yours is backed up, your values kept),
finds a database, creates the three it needs, migrates, loads fictional data and builds the
retrieval index. It can be run again at any time.

**It does not require Docker.** It prefers a database you already have, then Docker Compose, then
anything listening on a familiar port, and finally downloads a self-contained PostgreSQL 18 into
`.local-db/` — no service to install, no administrator rights. Docker is still the path
`compose.yaml` describes and the only way to get Mailpit; when Docker Desktop is running, setup uses
it. [docs/SETUP.md](docs/SETUP.md) covers all of this, plus host-versus-container addressing and a
troubleshooting table.

When something is wrong, `npm.cmd run doctor` reports missing variables, unreachable databases,
unapplied migrations and an empty retrieval index, each with the command that fixes it.

## Architecture

```mermaid
flowchart TB
    subgraph Browser
        UI[React + TypeScript + Vite<br/>role-aware pages, light/dark, mobile]
    end
    subgraph Server["Express API — one process"]
        AUTH[Sessions, CSRF, role guards]
        CORE[Tickets · assets · SLA · notes · audit]
        KB[Knowledge base<br/>visibility enforced in the query]
        AIB[AI boundary<br/>redact → fence → validate]
        WORK[Background worker<br/>SLA breach scan · outbox delivery]
    end
    subgraph Data
        PG[(PostgreSQL<br/>Prisma migrations)]
        CHUNKS[(ArticleChunk<br/>embeddings + exact cosine ranking)]
    end
    MAIL[Mailpit<br/>local sink only]
    OPENAI[(OpenAI API<br/>optional)]

    UI -->|HttpOnly cookie, same origin| AUTH
    AUTH --> CORE
    AUTH --> KB
    AUTH --> AIB
    CORE --> PG
    KB --> PG
    AIB -->|permission-filtered passages only| CHUNKS
    CHUNKS --- PG
    AIB -.->|disabled · mock · openai| OPENAI
    WORK --> PG
    WORK -->|SMTP 1025, loopback| MAIL
    AIB -->|suggestions only| UI
    UI -->|explicit human approval| CORE
```

Two edges carry the design. **`AIB → CHUNKS` is permission-filtered before ranking**, so a passage the
caller may not read is never a candidate and never reaches a prompt. **`AIB → UI → CORE` is not a
loop the model can close**: AI output reaches a person, and only a person's explicit action reaches
the write path. The model has no tool access, no database access and no network destination other
than the single provider call.

The AI boundary is one-way and toolless. It reads material the caller is already allowed to read, redacts it, sends text, and validates what comes back. The model cannot run a command, query or write the database, send mail, or reach any other network destination. Nothing it returns changes a record until a person presses a button.

One package and lockfile, separate `web/`, `server/`, and `shared/` source directories. This keeps beginner setup simple without microservices. The production build emits the API under `dist/server` and optimized static files under `dist/web`. With `NODE_ENV=production`, Express serves the built frontend itself. Production requires an HTTPS origin, secure cookies, real non-demo accounts and `MAIL_MODE=disabled`; infrastructure and bootstrap provisioning are later deployment work.

| Directory | Purpose |
| --- | --- |
| `web/` | Responsive React pages, styles, fetch client |
| `server/` | Authentication, permissions, tickets, assets, SLA, knowledge, notifications, metrics |
| `server/ai/` | Provider boundary, redaction, prompts, retrieval, usage limits, AI routes |
| `shared/` | Zod request validation and UI models/constants |
| `prisma/` | Schema, committed migrations, guarded fictional seed |
| `tests/` | Unit/API integration and Playwright browser tests |
| `tests/eval/` | Fictional evaluation dataset and its scorecard runner |
| `scripts/` | Cross-platform build and isolated test runners |
| `docs/` | API, security, roadmap, demo, validation and screenshots |

Single company per installation. Engineers and administrators may access every support ticket in that company. Employees can read and reply only to their own tickets. Admin includes engineer capabilities. Public registration has no endpoint.

## What works now

**Core ticketing (Phase 1, still passing):** login/logout, eight-hour PostgreSQL sessions, three roles, account creation and enabling/disabling; ticket numbering, creation, queue/detail, category, priority, assignment, public replies, controlled status changes and reopening; search, filters, sorting and pagination.

**Assets.** Unique asset tags, type, manufacturer, model, serial number, owner, status, purchase date and warranty expiry. Administrators create and edit; engineers see support-relevant hardware; employees see only what is assigned to them. Assets link to tickets with a backend authorization check on both the asset and the requester. Searchable, paginated inventory and detail pages showing related tickets the viewer is allowed to open. Transferring ownership immediately removes the previous owner's access, including the link shown on their own ticket.

**Internal notes and audit history.** Engineers and administrators add notes that are never returned to an employee through any response, search result, notification or activity feed. Notes are visually and structurally distinct from public replies. Assignment, priority, status, category and asset changes are recorded with actor and timestamp inside the same transaction as the change. There is no update or delete endpoint for audit records; administrators get a searchable audit log.

**SLA tracking.** Administrator-configurable first-response and resolution targets per priority, on a documented 24/7 clock with every timestamp stored in UTC. The first **public** engineer reply satisfies the first-response target — an internal note does not. Resolution time pauses while a ticket is Waiting for User and stops at resolution. Each ticket keeps a snapshot of the policy that applied when it started, so later settings changes never silently alter existing deadlines. Remaining time and breaches appear on ticket pages, the queue list and the dashboard.

**Knowledge base.** Administrators create, edit, publish and archive Markdown articles with employee-visible or support-team-only visibility. Visibility is enforced in the API for detail, list **and full-text search**, so a restricted article never leaks through a search result. Rendered Markdown is sanitized server-side. Category and status filters, and article search.

**Notifications.** Assignment, public replies and SLA breaches queue messages in a persistent outbox with leases, exponential backoff, and a unique key per recipient and event, so a retry never produces a duplicate row or a duplicate message. Employee notifications carry fixed template text only and never quote ticket or note content.

**AI assistance (Phase 3).** Engineers and administrators get an explicit **Analyze ticket** action returning a summary, a suggested category and priority, reasons quoted from the ticket, information to request, and safe troubleshooting steps. Nothing is applied until the engineer ticks what they accept and presses Apply, which revalidates permissions and values, refuses a suggestion computed against different text, and writes an audit record naming the person who accepted it. Engineers can also summarise a conversation (internal only) and draft a public reply, built from public material only, shown in an editable box, and sent only through the ordinary Send reply button.

**Knowledge answers with citations.** Anyone signed in can ask a question and get an answer built only from knowledge passages they are allowed to read, with clickable citations to the source article. Visibility is part of the retrieval query, not a filter applied afterwards, and every citation is revalidated against current permissions before the answer is returned. When the evidence does not support an answer, the system says so and suggests raising a ticket instead of guessing.

**Account security (Phase 5).** Sign-in lockout after five failures; a TOTP second factor with QR
enrolment, recovery codes and replay protection, optionally required per role; a password policy
with a forced change at first sign-in; password reset by emailed link or an administrator-issued
one-time link; a list of where you are signed in, with per-session revocation; administrator
controls for lockout, second-factor reset, role changes and reset links. Every action audited with
its source address. See [docs/SECURITY.md](docs/SECURITY.md).

**Operations (Phase 5).** Structured JSON request logs with correlation ids and no content;
Prometheus `/metrics` behind a token; liveness and readiness probes; graceful shutdown; backup and
restore scripts; daily retention. See [docs/OPERATIONS.md](docs/OPERATIONS.md).

**Governance (Phase 5).** Personal-data export for oneself and by an administrator; account
erasure that removes identifiers and credentials while keeping attributed records; streamed audit
export; a permission matrix that the test suite enforces. See [docs/GOVERNANCE.md](docs/GOVERNANCE.md)
and [docs/PERMISSIONS.md](docs/PERMISSIONS.md).

**Production deployment (Phase 5).** A hardened multi-stage image, a single-host compose with TLS
termination, a pre-flight that validates `.env.production` exactly as the application will, and a
CI job that builds and boots the image. **Written and reviewed, not yet run on a real host** — see
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

**Service-desk workspace (Phase 6).** Ticket types (incident / request / problem / change) with an
impact × urgency priority matrix, labels and due dates; a drag-and-drop **board** with quick
filters, saved and shared views and bulk actions; a **service catalog** with per-item forms and
manager / administrator / department approvals; templates; followers, **@mentions**, safe
**attachments**, reply editing and a unified activity stream; satisfaction ratings; **people and
departments** with cost centres, managers, a directory and profiles; announcements; a **Ctrl+K
command palette** with global search; a notification centre with unread state, preferences and
**live updates**; and reports by agent and department. See [docs/WORKSPACE.md](docs/WORKSPACE.md).

**Service Intelligence, Reports and Administration (V2 Phase 5).** A staff-only analytics page
computed on the server from stored rows: six headline figures with denominators and comparisons
that are shown only when both periods have data, per-day trends (volume, resolution, SLA outcome,
CSAT, backlog), demand by department, category, service and priority, SLA breaches by department and
priority, the age of open work, satisfaction with sample sizes, and an alphabetical — never ranked —
team table. Eight filterable reports with CSV export of exactly the filtered rows. One
Administration control plane: accounts and access, roles and permissions as the API enforces them,
a read-only workflow view, service levels, catalog, templates, announcements, the notification
outbox, AI settings, the audit log, a Security page that reports the protections actually in force,
and data retention. A split sign-in page with no invented SSO or self-registration, 403 and 404
pages, and a footer that says when live updates are reconnecting.

**Dashboard and interface.** Asset summaries, SLA compliance with stated denominators, breached and at-risk counts, a breached-ticket list, and engineer workload — all computed from stored records. Responsive navigation, light/dark preference, labeled controls, keyboard focus, and loading, empty, success and error states.

Status flow: **Open → In Progress → Waiting for User / Resolved → Closed**. Waiting for User can return to In Progress or become Resolved. A public employee reply while waiting resumes In Progress. Resolved/Closed tickets can reopen to Open; their resolution timestamp is cleared. Replies to Resolved/Closed tickets require reopening. Reassignment does not implicitly change status. Concurrent edits fail with HTTP 409 rather than silently overwriting another user's changes.

## SLA rules

The clock is continuous: 24 hours a day, 7 days a week, including weekends and holidays. Business-hours calendars are a deliberate later enhancement, not a claimed feature. All timestamps are stored in `TIMESTAMPTZ` and computed in UTC.

| Event | First-response timer | Resolution timer |
| --- | --- | --- |
| Ticket created | Starts | Starts |
| Internal note added | Unaffected | Unaffected |
| First public reply by an engineer or administrator who is not the requester | Satisfied, permanently | Unaffected |
| Status → Waiting for User | Unaffected — it never pauses | Pauses; consumed time is persisted |
| Requester replies while waiting | Unaffected | Resumes with the remaining budget, not a reset |
| Status → Resolved or Closed | Unaffected | Stops |
| Ticket reopened | Keeps any recorded breach | Restarts from the previously consumed time; earlier breach history is retained |

A breach timestamp, once recorded, is never cleared — a late reply satisfies the target *and* keeps the breach on record. Because consumed time is persisted rather than derived from process memory, restarting the application does not change any deadline.

Starter policy shipped by the migration, editable under **Settings → Service levels**:

| Priority | First response | Resolution |
| --- | --- | --- |
| Urgent | 15 min | 120 min |
| High | 60 min | 480 min |
| Medium | 240 min | 1440 min |
| Low | 480 min | 4320 min |

These are demonstration defaults, not contractual commitments.

## Notifications

`MAIL_MODE` has exactly two values. `disabled` queues notifications in the outbox and hands them to no transport. `mailpit` delivers to the local Mailpit sink that `compose.yaml` starts on `127.0.0.1:1025`, readable at http://localhost:8025.

There is no SMTP URL, relay host, credential or attachment setting, so the application cannot be pointed at a real mail server by configuration. `MAILPIT_HOST` accepts only `127.0.0.1`, `localhost` or the compose service name `mailpit`, and the port is fixed at 1025. Production refuses any value other than `disabled` at startup.

## AI: modes, guarantees and limits

`AI_MODE` has three values.

| Mode | What it does | Credentials |
| --- | --- | --- |
| `disabled` | Every AI feature is off. AI endpoints answer 503 and the interface says so. Tickets, SLA, assets, knowledge and notifications are untouched. | none |
| `mock` | A deterministic offline stand-in. Same output for the same input, no network calls, labelled **Mock AI** everywhere it appears. This is the default in `.env.example`, in Docker Compose, in CI and in the browser suite. | none |
| `openai` | The official OpenAI API over plain `fetch`, using the Responses API for structured output and the Embeddings API for retrieval. | `OPENAI_API_KEY` |

There is deliberately **no base-URL setting**, so the provider cannot be redirected to another host by configuration — the same closed-enum approach used for the mail transport. The key is read from the server environment only; it is never sent to the browser, never rendered in the administrator screen, and never included in an error message or log line.

### What is guaranteed, and by what

These properties are enforced by code outside the model, not by asking the model nicely:

- **Nothing is applied automatically.** Triage suggestions change nothing. Applying them is a separate request that re-checks the caller's role, revalidates the category and priority against the database, enforces the optimistic version, compares a fingerprint of the analysed text, and writes an audit record. A suggestion computed against different content is refused with a 409 and the interface tells the engineer to analyse again.
- **Nothing is sent automatically.** A draft is text in an editable box. It becomes a reply only when an engineer presses Send reply, through the same endpoint they would use for a hand-written reply.
- **The model has no tools.** No shell, no database access, no mail, no network beyond the single provider call. It returns text; this process validates it and either shows it to a person or discards it.
- **Restricted material never enters a prompt.** Visibility and status are conditions inside the retrieval query, so a support-only, draft or archived passage is not a candidate. Nothing relies on the model to keep a secret it was shown.
- **Citations are verified twice.** The model may only cite passage numbers it was given; invented numbers are discarded. Every surviving citation is then re-checked against current permissions, so an article restricted between retrieval and response is dropped rather than returned.
- **The application works without AI.** Ticket creation, replies, SLA and everything else are unaffected by an AI outage, timeout or misconfiguration. There is an automated test that creates, replies to and resolves a ticket with the provider disabled.

### What is mitigated but not guaranteed

Stated plainly, because the difference matters:

- **Prompt injection is reduced, not solved.** Ticket text and article text are fenced as untrusted data with a standing instruction not to follow embedded commands. No prompt wording defeats every injection. The defences that actually hold are the structural ones above: no tools, permission filtering before retrieval, citation revalidation, and human approval before any change.
- **Redaction is best-effort.** Recognisable secrets, keys, tokens, card numbers, email addresses and IP addresses are stripped before anything leaves the process. Pattern matching cannot catch every secret — an unusual internal token format, or a password typed as ordinary prose, will get through. Keep telling people not to paste credentials into tickets.
- **Hallucination is constrained, not eliminated.** Answers are built only from retrieved passages, the model is told to refuse when evidence is insufficient, and every claim is traceable to a cited source. It can still summarise a source wrongly. The interface says so: citations show the source, not that the answer is correct.
- **No confidence figures.** The system never states a confidence score, percentage or probability, because it has no calibrated basis for one.

### Retrieval and pgvector

Published articles are split into passages that follow Markdown headings, embedded, and stored with the article version, the embedding model and the vector size. Editing an article deletes its passages immediately — the index fails closed, so a stale or newly-restricted passage cannot be served while a reindex is pending. Passages embedded by a different model are never comparable and are excluded from ranking, then removed on the next reindex.

**Ranking uses an exact cosine-distance SQL function over the permission-filtered candidate set. It does not use a pgvector index, and the schema is not currently index-ready.** The migration enables the `vector` extension when the database provides it, but `ArticleChunk.embedding` is `double precision[]`, and pgvector's HNSW and IVFFlat indexes require a `vector` column — so adopting an approximate index would need a further migration, not just an `CREATE INDEX`. [docs/RETRIEVAL.md](docs/RETRIEVAL.md) documents the implementation, the measured latency, and exactly what that migration would involve.

Exact ranking is a deliberate choice at this scale rather than a stopgap: it returns the true nearest passages instead of an approximation, needs no index rebuild when content changes, and runs on a stock PostgreSQL server.

### Cost

Token counts are measured from provider responses and shown in **Settings → AI & retrieval**. No monetary figure is displayed or estimated anywhere, because prices change and vary by account — check your provider dashboard. Per-user usage is capped (`AI_DAILY_USER_LIMIT`, default 50 requests per rolling 24 hours), concurrency is bounded, inputs and outputs are size-capped, and every call has a timeout. Failed calls are recorded too, so errors cannot be used to consume budget invisibly.


## Dashboard definitions

All metrics use the authenticated user's accessible records. Employees see their own tickets and their own assigned assets; staff see the workspace. There is no implied time window and no fabricated trend or percentage.

| Metric | Definition |
| --- | --- |
| Active tickets | Status Open, In Progress, or Waiting for User |
| Unassigned | Active tickets with null assignee |
| SLA breached | Active tickets with a recorded or currently-evaluated first-response or resolution breach |
| At risk | Active, unbreached tickets whose nearest governing deadline has 25% or less of its target budget remaining; a paused resolution clock is excluded from the comparison |
| Status breakdown | Count of all accessible tickets per current status |
| Priority/category breakdown | Active tickets per current priority/category |
| Workload | Active assigned tickets grouped by assignee; shown to staff |
| Average first response | Mean minutes from creation to first public staff reply by someone other than the requester, among tickets with such a reply |
| Average resolution | Mean elapsed minutes from creation to current resolution timestamp, among tickets with one; closed tickets retain it, reopened tickets are excluded until resolved again |
| First response met | Percentage over tickets that **already received** a first public engineer reply. Denominator excludes tickets still awaiting one |
| Resolution met | Percentage over tickets that **reached** Resolved or Closed. Denominator excludes tickets still open |
| Asset summary | Counts over the assets the viewer is authorized to list: total, by type, unassigned excluding retired, and warranty expiring within 90 days |

Tickets with an unfinished outcome are never folded into a compliance percentage; they are reported separately as breached or at risk. Average first response and average resolution are wall-clock durations, distinct from SLA compliance. Refresh or navigate back to Overview after changes to load updated metrics; no realtime push is implemented.

## Tests and build

`npm run setup` already created the two **separate disposable databases** the suites need. With a
database running:

```powershell
npm.cmd test
npx.cmd playwright install chromium
npm.cmd run test:e2e
npm.cmd run build
npm.cmd audit --audit-level=high
```

If setup fell back to the self-contained PostgreSQL, start it first in another terminal with
`npm.cmd run db:local`. Test runners apply migrations and enforce safe database-name suffixes. API tests create isolated synthetic fixtures and remove only those fixtures; E2E tests seed/reuse their own database and add uniquely named demonstration records. They never target the main database. E2E uses ports 3002/5174 and starts/stops its own servers. Keep these ports free. For just the pure unit tests: `npx.cmd vitest run tests/domain.test.ts tests/sla.test.ts`.

SLA and notification tests inject a controllable clock into the application rather than waiting on real time, so deadlines, pauses, resumes, reopening and retry backoff are asserted deterministically. AI tests inject the deterministic mock provider, or a stubbed HTTP transport when they need to exercise the real provider's request and response handling. **No API key is needed to run any test, and CI never has one.**

The knowledge evaluation in `tests/eval/` runs a small fictional dataset covering answerable questions, insufficient evidence, restricted knowledge and malicious instructions. Safety expectations are assertions; retrieval-quality expectations are measured and reported as a scorecard, because quality depends on the embedding model and the mock is a lexical hashing vectoriser rather than a semantic one.

To evaluate a real provider — opt-in, local, and billed to your account:

```powershell
$env:AI_MODE = 'openai'
$env:OPENAI_API_KEY = '<your key>'
npm.cmd run eval:real
```

A passing mock run says the plumbing is correct. It says nothing about a real model's answer quality. See [Validation results](docs/VALIDATION.md) for measured counts.

Most recent full run on the release-candidate code (v2.0.0-rc1; Node 24.13, embedded PostgreSQL
18): Vitest **362 passed / 0 failed** across 22 files; Playwright **35 passed / 0 failed**, three
consecutive full runs from a freshly reset database; `npm audit` 0 vulnerabilities; the client
bundle 502 kB JS (138.1 kB gzip) with staff and administration routes lazy-loaded, 190 kB CSS
(31.7 kB gzip). axe-core (WCAG 2.2 AA rule sets) reports 0 violations across the 26 Phase 5 page
states and the 18 RC states (including the session-expired dialog and the offline error). The
release-candidate hardening — audit, findings, fixes, what was and was not verified — is in
[docs/RC-AUDIT.md](docs/RC-AUDIT.md), [docs/RC1-CHANGES.md](docs/RC1-CHANGES.md) and
[docs/RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md); operating it is
[docs/OPERATIONS-RUNBOOK.md](docs/OPERATIONS-RUNBOOK.md), [docs/BACKUP-RESTORE.md](docs/BACKUP-RESTORE.md)
and [docs/SECURITY.md](docs/SECURITY.md); the sales demo is [docs/DEMO-SCRIPT.md](docs/DEMO-SCRIPT.md).

The GitHub Actions workflow runs locked install, generation, build, integration tests, Chromium tests, and dependency audit using PostgreSQL. Push this repository root to GitHub to run it; the workflow has not been executed on GitHub in this session.

## Screenshots

Captured from the running application with fictional seed data. AI output is produced by the
deterministic mock provider and is labelled **Mock AI** in the interface, exactly as shown.

| | |
| --- | --- |
| ![My space: live counts, assignments with SLA, approvals, quick requests, recent activity](docs/screenshots/home.png) | ![Service Desk list view with filter bar, chips, saved views and the enterprise data table](docs/screenshots/service-desk.png) |
| **My space** — what is yours, what needs you, and the fastest way to ask for more. | **Service Desk** — list, board and analytics share one filter bar; every state is a link. |
| ![The board with cards by stage](docs/screenshots/board.png) | ![Operations command center with metrics and the needs-attention list](docs/screenshots/dashboard.png) |
| **Board** — drag cards between stages; the workflow rules decide where a card may land. | **Command center** — six live metrics and exceptions derived from them, each linking to where it is fixed. |
| ![Service catalog marketplace](docs/screenshots/catalog.png) | ![Three-step request flow with review](docs/screenshots/request-flow.png) |
| **Catalog** — search, category chips, grouped services with their approval route. | **Request flow** — details, then a review of every answer before anything is sent. |
| ![Three-column ticket workspace](docs/screenshots/ticket-workspace.png) | ![AI assistance panel on a ticket](docs/screenshots/ai-ticket-panel.png) |
| **Ticket workspace** — context on the left, conversation and AI in the middle, properties on the right. | **AI assistance** — suggestions the engineer approves, a draft they edit and send themselves, clearly labelled. |
| ![Command palette](docs/screenshots/palette.png) | ![Notification panel with tabs](docs/screenshots/notifications-panel.png) |
| **Ctrl+K** — pages, actions, tickets, people, articles and assets from one box, with recents. | **Notifications** — All / Unread / Mentions / Approvals / SLA, unread count in the tab title. |
| ![Departments](docs/screenshots/departments.png) | ![Approval Center](docs/screenshots/approvals.png) |
| **Departments** — hierarchy, cost centres, managers and the support demand each team generates. | **Approval Center** — needs my approval, requested by me, completed. |
| ![A knowledge answer with clickable citations](docs/screenshots/ask-citations.png) | ![The same interface declining to answer for lack of evidence](docs/screenshots/ask-abstains.png) |
| **Cited answer** — built only from passages this employee may read, each citation clickable. | **Abstention** — the answer nobody screenshots, and the one that matters most. |
| ![Dark theme home](docs/screenshots/home-dark.png) | ![Ticket detail on a 390px viewport](docs/screenshots/mobile-ticket.png) |
| **Dark mode** — a deliberate second palette, not an inversion. | **Mobile** — the same workflow at 390 × 844 with an off-canvas navigation drawer. |

The second-generation screens are in `docs/screenshots/v2/` — the final matrix is `p5-*.png`
(sign-in light/dark/phone, My Space, catalog, request, approvals, knowledge, person, asset, Command
Center, Service Desk, board, ticket workspace, Service Intelligence, reports, administration
overview, accounts, workflow, roles, service levels, catalog admin, audit, security, data, 403 and
404, at 1920 light and dark, 1366 and 390).

Also: [analytics view](docs/screenshots/analytics.png), [reports](docs/screenshots/reports.png),
[people](docs/screenshots/people.png), [asset inventory](docs/screenshots/assets.png),
[knowledge base](docs/screenshots/knowledge.png), [administration](docs/screenshots/settings.png),
[AI settings](docs/screenshots/ai-settings.png), [board in dark mode](docs/screenshots/board-dark.png),
[sign-in](docs/screenshots/login.png).

The interface is built on a documented design system — tokens, components, light and dark palettes,
accessibility rules — in [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md). The redesign's verified
change summary, test evidence, limitations and next steps are in
[docs/REDESIGN-CHANGELOG.md](docs/REDESIGN-CHANGELOG.md).

## Security, limitations and next phases

**Release candidate v2.0.0-rc1 is scoped to the native Windows/Node deployment.** It was validated
on a real release host — startup, repeat startup, failure handling, database and upload persistence,
364 API/unit tests and 35 browser tests all passing there. The container deployment
(`compose.prod.yaml`, `Dockerfile`, Caddy) **ships unverified**: reviewed but never built or run, at
the owner's direction. See [DEPLOYMENT.md](docs/DEPLOYMENT.md) and
[RC1-HOST-VALIDATION.md](docs/RC1-HOST-VALIDATION.md).


| Document | What it covers |
| --- | --- |
| [SETUP.md](docs/SETUP.md) | Complete Windows setup, host vs container addressing, troubleshooting |
| [CASE-STUDY.md](docs/CASE-STUDY.md) | Decisions, defects found, measured results, limitations |
| [VALIDATION.md](docs/VALIDATION.md) | Exactly what was executed, with versions and results |
| [RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md) | Verified / implemented but unverified / deferred |
| [RETRIEVAL.md](docs/RETRIEVAL.md) | How ranking works, measured latency, the pgvector migration path |
| [EVALUATION.md](docs/EVALUATION.md) | The evaluation set, release criteria and what the scores mean |
| [SECURITY.md](docs/SECURITY.md) | Security decisions and stated limitations |
| [API.md](docs/API.md) · [DEMO.md](docs/DEMO.md) · [ROADMAP.md](docs/ROADMAP.md) | Endpoints, demo script, phase history |

**Not implemented:** attachments; article version history and rich-text editing; business-hours SLA calendars; per-category assignment rules; full accessibility audit; AWS/Terraform deployment; persisted AI answer history (deliberately omitted — storing answers would outlive the permissions of their sources unless revocation were implemented, which is out of scope here); pgvector index-backed ranking. No UI claims these features work.

Portfolio trade-offs: one company per installation, no SSO/MFA/password reset, no multi-instance rate-limit store, no WebSocket updates. The background worker runs in-process on a 30-second interval, which suits a single-instance demo; multiple instances would need a shared scheduler, though the outbox already uses row leases with `SKIP LOCKED` so concurrent delivery is safe. Audit data is application-controlled rather than immutable external logging. Sessions have an absolute expiry, and expired rows are cleaned at login. Administrators can create users and enable/disable them; role editing, password rotation and administrator bootstrap tooling remain later hardening. Search uses PostgreSQL substring matching; metrics load scoped records in memory, which is appropriate for this small demo but would need SQL aggregates and indexes at larger scale.

## Official references checked

Dependency versions are exact in `package.json` and `package-lock.json`. Prisma 7.10 was selected over the registry's Prisma 8 release candidate. Narrow overrides update Prisma CLI transitive `deepmerge-ts` and `mysql2`; generation, migration and tests were rerun after that change. Review/remove overrides when upstream resolves them.

- [Vite setup and supported Node versions](https://vite.dev/guide/)
- [Tailwind Vite plugin](https://tailwindcss.com/docs/installation/using-vite)
- [Prisma configuration](https://www.prisma.io/docs/orm/reference/prisma-config-reference)
- [Prisma 7 upgrade and adapters](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7)
- [Express security guidance](https://expressjs.com/en/advanced/best-practice-security/)
- [Node scrypt](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)
- [Zod](https://zod.dev/), [Vitest](https://vitest.dev/guide/), [Playwright web servers](https://playwright.dev/docs/test-webserver)
- [sanitize-html](https://github.com/apostrophecms/sanitize-html#readme), [marked](https://marked.js.org/), [Nodemailer SMTP transport](https://nodemailer.com/smtp/)
- [Mailpit](https://mailpit.axllent.org/docs/)

## Troubleshooting

- Anything at all: `npm.cmd run setup` is idempotent and repairs most of what goes wrong. `npm.cmd run doctor` explains the rest.
- `P1001` / database unreachable: no database is running. `npm.cmd run db:local`, or `docker compose up -d db`. Host port is **5433**; inside the app container it is `db:5432`.
- "lock file postmaster.pid already exists": a local database was killed rather than stopped. The next start clears the lock once it confirms the old process is gone.
- Port already in use: stop the other dev process. Change `PORT`, `WEB_PORT` and `APP_ORIGIN` together if customizing; Vite's proxy uses `PORT`. `npm run dev:web` binds loopback (`WEB_HOST`, default `127.0.0.1`).
- Prisma client missing: run `npm.cmd run db:generate` before build/dev and after schema changes.
- Sign-in fails: check the email and the exact password passed when seeding. The seed does not install a universal fixed password.
- HTTP 403 on mutations: browse the exact `APP_ORIGIN`; do not switch between localhost and 127.0.0.1. Sign in again to renew the session/CSRF token.
- HTTP 409 on save: another edit/reply changed the version. Reload the record and reapply your intended change.
- No mail in Mailpit: confirm `MAIL_MODE=mailpit`, that `docker compose ps` shows the `mailpit` container, and that the outbox row is not already `SENT` under **Settings → Notification outbox**. The worker runs every 30 seconds.
- SLA figures look wrong after upgrading: check whether the ticket is marked as a legacy backfill on its detail page. Backfilled tickets started their clock at upgrade time by design.
- New migration during development: edit the Prisma schema, run `npx.cmd prisma migrate dev --name descriptive_change` on your development database, inspect the SQL, and commit it. Never run this against production.
