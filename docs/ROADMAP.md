# Incremental delivery

## Phase 1 — complete

One reliable employee-to-engineer ticket workflow, authentication/roles, category seed, dashboard, administration of account creation/activation, real database integration tests, an initial browser suite and CI definition.

## Phase 2 — complete (current slice)

Delivered and validated: assets with ownership checks and linked tickets, seeded with fictional laptops, desktops, access points, printers and switches; internal notes restricted to staff and excluded from every employee-facing path; a readable audit timeline plus an administrator audit log; knowledge articles with employee/support visibility enforced in detail, list and search, and server-side Markdown sanitization; administrator-configurable SLA policy with per-ticket snapshots on a 24/7 clock; a persistent notification outbox delivering to a local Mailpit sink; dashboard SLA compliance, breach and asset summaries; and additional API and browser tests for each permission boundary. See [Validation results](VALIDATION.md).

The SLA design proposed during Phase 1 was implemented as specified: policy snapshot at creation; the first-response timer starts at creation, is satisfied by the first public staff reply from someone other than the requester, and never pauses; the resolution timer pauses only in Waiting for User, resumes with the remaining budget, stops at Resolved and remains stopped at Closed; reopening resumes accumulated time and retains breach history; reassignment and priority changes do not reset the snapshot; cumulative elapsed time is persisted, and `Clock.now()` is injected so every transition is tested deterministically. Business-hours calendars remain later work.

Deferred out of Phase 2 by choice: attachments, article version history, per-category assignment rules, and rich-text authoring.

## Phase 3 — AI — complete (current slice)

Delivered and validated: a server-side provider boundary with disabled, deterministic-mock and real OpenAI modes; explicit ticket triage with human approval, a content fingerprint that refuses stale suggestions, and an audit record naming the accepting engineer; internal conversation summaries; public reply drafts built from public material only and sent only by a person; permission-aware knowledge retrieval with server-verified citations and an explicit insufficient-evidence path; additive pgvector-ready migration with chunking, index-state tracking, fail-closed invalidation and embedding-model staleness handling; redaction, timeouts, bounded retries, concurrency and per-user usage limits; an administrator AI settings and index screen; and a fictional evaluation dataset with a reported scorecard. See [Validation results](VALIDATION.md).

The original Phase 3 plan is reproduced below; every item is implemented except the two noted at the end.


Server-side provider interface with explicit mock mode and configurable OpenAI provider; Zod-validated triage; accept/reject records; reviewed reply drafts and conversation summaries. PostgreSQL pgvector migration, chunking and embeddings for administrator-authored Markdown. Filter permissions **before** retrieval; cite only retrieved accessible chunks. Insufficient evidence → explicit escalation, not invented answers. Restrict related tickets to accessible records. No direct provider access from the browser and no automatic sending/execution.

Add timeout, concurrency/rate/usage limits, redaction, minimal personal data, graceful provider failure, injection fixtures, retrieval/answer evaluations, and proof that provider failure cannot block ticket creation. Mock answers must be labeled as mock; no confidence percentages. AI acceptance criteria are pending, and are not met merely by the absence of AI in Phases 1 and 2.

Phase 2 deliberately built the substrate this phase needs: articles already carry a visibility field that is enforced before any read, and internal notes are already segregated, so retrieval filters on permissions rather than bolting them on afterwards.

**Deferred out of Phase 3 by choice, and why:**

- *Persisted answer history.* Storing generated answers creates records that outlive the permissions of the sources they were built from. Doing it safely needs source-revocation behaviour that was out of scope here, so nothing about an answer is kept.
- *pgvector index-backed ranking.* The extension is enabled by the migration, but ranking uses an exact cosine SQL function over the permission-filtered candidate set, which is exact and fast at this scale. **Correction to an earlier Phase 3 statement:** that note claimed an approximate index could be added without another schema migration. That was wrong. `ArticleChunk.embedding` is `double precision[]` and pgvector indexes require a `vector` column, so adoption needs a further migration — see [RETRIEVAL.md](RETRIEVAL.md). The pgvector code path remains unexercised in the validation environment.
- *Related resolved tickets.* Suggesting similar past tickets needs the same permission-scoped retrieval applied to ticket bodies, plus a decision about whether an engineer may see a ticket they are not assigned to. Left to a later slice rather than half-built.

## Phase 4 — release validation and portfolio readiness — complete

Reproducible setup, container verification script, retrieval performance and honest pgvector claims, held-out evaluation cases, provider error handling against current documentation, UX audit, case study and screenshots. See [VALIDATION.md](VALIDATION.md).

## Phase 5 — runnable anywhere, then enterprise readiness — complete

`npm run setup` and `start.bat`: one command from a bare clone to a running application, with a self-contained PostgreSQL 18 when Docker is absent. Then: account security (TOTP second factor with recovery codes, lockout, password policy, forced first-sign-in change, reset links, session management, MFA-required roles), operations (structured logs with request ids, Prometheus metrics, liveness and readiness, graceful shutdown, backup and restore), production deployment (hardened multi-stage image, single-host compose with TLS, pre-flight validation, CI image build) and governance (audit export, personal-data export and erasure, retention, a tested permission matrix). See [DEPLOYMENT.md](DEPLOYMENT.md), [OPERATIONS.md](OPERATIONS.md), [GOVERNANCE.md](GOVERNANCE.md), [PERMISSIONS.md](PERMISSIONS.md).

**Still deliberately not built:** SSO/SAML/OIDC; a shared store for rate limits and lockout counters across replicas; a real SMTP transport; attachments; multi-tenancy; WebAuthn/passkeys; an external immutable audit sink. Each is a design decision, not an oversight — see [SECURITY.md](SECURITY.md).

## Phase 6 — service-desk workspace — complete

Ticket types and the impact × urgency matrix, labels and due dates; the drag-and-drop board with saved views and bulk actions; the service catalog with dynamic forms, templates and approvals; followers, mentions, attachments, reply editing and the activity stream; satisfaction ratings; departments with cost centres and managers, the directory and profiles; announcements; the command palette and global search; the notification centre with preferences and live updates; reports. See [WORKSPACE.md](WORKSPACE.md) and [VALIDATION.md](VALIDATION.md).

**Deliberately not built:** multi-level approval chains, per-department routing and SLA calendars, attachment previews, collaborative editing, an org-chart visualisation.

## V2 — second-generation interface — complete

Five phases rebuilt every screen on the design system without changing the schema beyond one
additive table (`ArticleFeedback`): shell and Command Center; Service Desk, board and ticket
workspace; My Space, catalog, requests, approvals and notifications; knowledge, assets, people and
departments; Service Intelligence, reports, the Administration control plane, sign-in and the
global states. See [REDESIGN-CHANGELOG.md](REDESIGN-CHANGELOG.md).

**Recommended next, not started:** SSO (SAML/OIDC) and SCIM; approval chains and per-department
routing; business-hours SLA calendars; per-account UI preferences; team-scoped views; attachment
previews; scheduled report exports; CMDB-style asset relationships.

## Optional cloud

Extend E2E coverage to the AI flows, run a full accessibility audit with an automated tool and manual keyboard review, verify clean-clone Docker startup on Windows, refine CI, publish measured evaluation results and complete the AI-inclusive demo. Add a production administrator bootstrap and password rotation before deployment.

Optional AWS architecture: a single containerized application behind HTTPS with private RDS PostgreSQL, private object storage only when attachments are ready, Secrets Manager and CloudWatch. Evaluate a small ECS/Fargate deployment vs. a simpler single-host portfolio environment before adding Terraform. Cost drivers include always-on compute, RDS instance/storage/backups, load balancer, NAT if selected, logs, egress, object storage and model/embedding usage. No price quote or resource has been provisioned. Estimate current region-specific prices and obtain approval before any paid deployment.
