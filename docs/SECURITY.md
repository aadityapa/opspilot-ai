# Security

What OpsPilot V2 RC1 does to protect accounts, data and files; what it deliberately does not do;
and what a deployment must provide around it. Nothing here is a certification claim. No external
penetration test has been performed; the controls below are exercised by the automated suites
named in each row (`tests/rc-security.test.ts`, `tests/security.test.ts`, `tests/auth.test.ts`,
`tests/permissions.test.ts`, `tests/e2e/security.spec.ts`, `tests/e2e/resilience.spec.ts`).

## Authentication model

| | |
| --- | --- |
| Sign-in | Email + password over HTTPS; optional TOTP second factor (per-account, or required per role by `MFA_REQUIRED_ROLES`); ten hashed recovery codes; replay-protected TOTP steps |
| Enumeration | One 401 message for unknown, wrong-password, locked and disabled accounts; a dummy hash is verified for unknown accounts so timing matches; password-reset requests answer 202 identically whether or not the address exists |
| Brute force | `LOGIN_RATE_LIMIT` attempts per source address per 15 minutes on `/auth/login` and `/auth/reset`; a tighter limit on `/auth/forgot`; per-account lockout after `LOCKOUT_THRESHOLD` failures for `LOCKOUT_MINUTES` |
| Sessions | Server-side rows keyed by the SHA-256 of a 32-byte random token; `SESSION_HOURS` absolute lifetime (8 h default); sign-in deletes the presented old session (no fixation) and expired rows; per-session revocation and "sign out everywhere"; role and active flag re-read on every request; MFA-pending sessions reach only the MFA and sign-out routes |
| Cookie | `HttpOnly`, `SameSite=Strict`, `Path=/`, no `Domain`; `Secure` and the `__Host-` prefix in production. Nothing about the session is stored in browser storage |
| CSRF | Exact `Origin` match on every non-GET `/api` request **and** a per-session random token in `X-CSRF-Token`, compared in constant time |
| Session end while working | A 401 during work opens an in-place re-authentication dialog; the page, its drafts and filters stay mounted; signing in as a different account reloads the application so no state crosses accounts |

## Authorization model

Three roles (`EMPLOYEE`, `ENGINEER`, `ADMIN`) enforced by route guards, plus object-level checks
on every record read or changed: a ticket is visible to its requester, its named approvers and
support staff (`canAccess`); assets, articles, notifications and people data each have a scope
function applied inside the query, never afterwards. Frontend visibility is never authorization:
every route the interface hides is refused by the API with 403 or 404, and `tests/permissions.test.ts`
fails the build if a route exists that the matrix does not document. Bulk actions and board moves
re-check each ticket. Concurrent writes to one ticket are serialised by a row lock and an
optimistic `version`; a second decision on the same approval gets 409.

Refusals for records the caller may not see are 404, not 403, so ids cannot be probed.

## Password handling

scrypt (N = 2¹⁷, r = 8, p = 1, 64-byte key, 16-byte per-user salt, 256 MiB memory cap) with a
constant-time comparison. Policy: at least 12 characters, not a common password, not containing
the person's own name or email. Administrator-created accounts must change the password at first
sign-in; reset links are one-time, 30 minutes (self-service) or 24 hours (administrator-issued),
and revoke every session when used. Hashes never leave the server: no API response, log line,
export or search result carries `passwordHash`, `mfaSecret` or session token hashes (asserted).

## Attachment controls

Allow-list by extension **and** declared content type **and** leading magic bytes for binary types;
one file per request, `ATTACHMENT_MAX_MB` (10 MB default) enforced by the parser before any byte is
stored; empty files refused. Files are written under `UPLOAD_DIR/<ticketId>/<32 hex>.<ext>` — the
name is server-generated, so the original filename never touches the filesystem — and the
resolved path is checked to lie inside `UPLOAD_DIR`. Downloads require access to the ticket, use the
stored type, force `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`,
`Cache-Control: no-store` and a `default-src 'none'; sandbox` CSP, so nothing is ever rendered
inline. Deletion is restricted to the uploader or an administrator. There is no malware scanning
and no inline preview.

## Audit logging

Every authentication event (including failures, with source address), every administrative action,
every ticket change, approval, attachment, export and erasure writes an append-only `Event` row
inside the same transaction as the change. There is no API to edit or delete one. Retention prunes
only events not attached to a ticket, after `RETENTION_AUDIT_DAYS`. The audit export is
administrator-only and is itself audited. Audit records are protected by application access control
and the absence of write endpoints, not by cryptographic tamper-evidence; anyone with database
credentials can alter them.

## Rate limits

| Endpoint | Limit (per source address, per process) |
| --- | --- |
| `POST /auth/login`, `POST /auth/reset` | `LOGIN_RATE_LIMIT` / 15 min (default 20) |
| `POST /auth/forgot` | half of that, minimum 5 / hour |
| `GET /search` | 120 / minute |
| `GET /analytics`, `GET /reports/:kind` (JSON and CSV), `GET /admin/audit/export`, `GET /dashboard` | 60 / minute |
| `POST /tickets/:id/attachments` | 60 / 15 min |
| AI endpoints | `AI_DAILY_USER_LIMIT` per account per rolling 24 h and `AI_MAX_CONCURRENCY` in flight |

Ordinary ticket reads and writes are not limited. Limits are in memory and per process; with more
than one API replica each replica counts separately. Under the test runner the per-route limits are
multiplied so suites never fail on them; the login limit is raised explicitly by the e2e runner.

## Security headers and CORS

`helmet()` defaults on every response: `Content-Security-Policy` (`default-src 'self'`,
`script-src 'self'`, `frame-ancestors 'self'`, `object-src 'none'`, `upgrade-insecure-requests`),
`Strict-Transport-Security` (in production, and again at the proxy), `X-Content-Type-Options`,
`X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`; `X-Powered-By` removed;
`Cache-Control: no-store` on every `/api` response. CORS allows exactly `APP_ORIGIN` with
credentials; the header never reflects the caller's origin. The single-page application is served
from the same origin as the API, so the CSP needs no relaxation beyond Google Fonts over HTTPS.

## Request limits and input

JSON bodies are capped at 32 kB (413 with a readable message); uploads by `ATTACHMENT_MAX_MB`. Every
body and query is parsed by a strict Zod schema: unknown fields are rejected (mass assignment is
impossible), sort keys and filters are enums, ids are UUIDs, pagination is bounded, bulk actions
take at most 100 ids, dynamic catalog answers are validated against the item's declared fields and
unknown keys are dropped. Prototype-pollution keys in JSON cannot reach application objects (asserted).

## Data boundaries

Employees see their own tickets, requests, assets and notifications, employee-visible articles and
the directory (name, title, department, manager, work email); support-only articles, other people's
tickets and internal notes are excluded in the query. Search obeys the same scopes per branch.
Report and audit CSV exports run behind the same guards as their JSON and neutralise cells that a
spreadsheet would treat as a formula (`=`, `+`, `-`, `@`, tab, CR) by prefixing a single quote,
leaving plain numbers untouched. Error responses carry a message and a request id, never a stack,
SQL or path; the database being unreachable is a distinct 503. Logs record request metadata (id,
method, collapsed route, status, duration, IP, user id, user agent) and never bodies, query strings,
cookies, headers or ticket text.

## Known security limitations

- No SSO/SAML/OIDC, no SCIM, no IP allow-lists, no per-role session policy. The Security
  administration page says so rather than showing switches.
- Rate limiting and lockout counters are per process / per database; a multi-replica deployment
  needs a shared limiter store to keep the per-address limits global.
- Audit rows are append-only by application design, not tamper-evident cryptographically.
- No malware scanning of uploads; no attachment previews (by design — download only).
- The AI provider receives ticket text when `AI_MODE=openai`; secrets are redacted before any call
  and the mode is off by default. Model output is treated as an unverified suggestion.
- No security monitoring or alerting beyond `/metrics` and the audit log.

## Deployment assumptions

TLS termination at a reverse proxy that sets `X-Forwarded-Proto` (the API trusts exactly one hop);
`APP_ORIGIN` equal to the public HTTPS origin; `APP_SECRET` (≥ 32 chars) present — production
refuses to start without it, with demo seeding on, with a non-HTTPS origin, or with Mailpit;
the database on a private network with a strong password; `uploads` on persistent storage
writable by the unprivileged container user; `/metrics` blocked at the proxy (the shipped
Caddyfile does) or protected by `METRICS_TOKEN`. See [DEPLOYMENT.md](DEPLOYMENT.md) and
[OPERATIONS-RUNBOOK.md](OPERATIONS-RUNBOOK.md).

## Appendix — decision record by phase

- Passwords use Node's asynchronous scrypt, N=131072, r=8, p=1, 16 random salt bytes, 64-byte derived key, 256 MiB max memory. Hash comparisons are timing-safe. Unknown-account login also computes a dummy hash. Login is capped at `LOGIN_RATE_LIMIT` attempts per IP per 15 minutes (default 20). It is raised only where many people legitimately share one address, or for the automated browser suite; the production default is unchanged. This process-local limiter is suitable for one API instance; distributed deployments need a shared store and trusted proxy configuration.
- Session tokens are 32 random bytes. Only SHA-256 token hashes are stored in PostgreSQL. Sessions expire absolutely after eight hours. Login rotates the browser's previous session; logout deletes it. Active role/account status is read on every request. Disabling a user revokes sessions transactionally.
- Cookies use HttpOnly, SameSite=Strict, path `/`, and no Domain. Production adds Secure and the `__Host-` prefix. Never put session tokens or API credentials into localStorage. The browser stores only theme preference there.
- Exact Origin checks cover login and every mutation; authenticated mutations also require a per-session random synchronizer token in a custom header. CORS is restricted to one configured origin. Missing Origin is rejected even for CLI clients; send it explicitly.
- Backend access checks precede ticket detail/reply/reopen operations. Ticket list and dashboard scope are enforced in the query. Staff privileges are required for changes. Non-owners get the same 404 as nonexistent records. Public reply reads filter `internal=false`. Attachments are covered in the RC1 summary above.
- A database transaction and row lock serialize replies, updates and reopening. Ticket updates require an optimistic version. Important changes write audit records inside the same transaction. Audit details contain IDs/statuses, not password hashes or reply bodies.

## Phase 2 additions

- **Internal notes** live on the reply table behind an `internal` flag and are reachable only through staff-guarded routes. Every employee-facing path filters them out: ticket detail, ticket search, the notification feed, notification bodies, and the dashboard. Three separate automated tests assert that note text cannot be recovered through any of those paths.
- **Audit records** are append-only by construction. There is no update or delete endpoint for events, and the only read paths are the staff ticket timeline and the administrator audit log. A `PATCH` against a timeline URL returns 404 rather than silently succeeding.
- **Asset access** is a query-level scope, not a UI concern: employees match on ownership, engineers on support relevance, administrators on everything. Transferring ownership immediately removes the previous owner's access — including the asset link rendered on a ticket they still own, which is nulled in the response rather than merely hidden. Linking a ticket to an asset the caller cannot access, or to an asset belonging to a different requester, returns 404.
- **Knowledge visibility** is applied as a `where` clause before any read, so it constrains the detail route, the list route, the total count and full-text search alike. A support-only runbook cannot be discovered by searching for a phrase inside it. Rendered Markdown is sanitized on the server with an allow-list of tags and attributes; scripts, inline event handlers and non-`http(s)` link schemes are stripped, and outbound links get `rel="noopener noreferrer"`. The client renders only that sanitized output.
- **SLA policy is snapshotted per ticket.** Changing a target cannot retroactively alter an existing ticket's deadlines or erase a recorded breach, and the policy change itself is audited. Consumed time is persisted rather than derived from process memory, so a restart cannot shift a deadline.
- **Notification transport is a closed enum.** `MAIL_MODE` accepts only `disabled` or `mailpit`; `MAILPIT_HOST` accepts only `127.0.0.1`, `localhost` or the compose service name; the port is fixed at 1025. There is no SMTP URL, relay, credential or attachment setting, so the application cannot be reconfigured into sending real external mail. Production refuses any mode other than `disabled` at startup. Message bodies are fixed templates naming a ticket number and never quote user content.
- **The outbox is idempotent.** Each row has a unique key derived from the event and the recipient, delivery is leased with `FOR UPDATE SKIP LOCKED`, and retries reuse the existing row. Recipient authorization is re-checked at delivery time, so a job queued for someone who has since lost access is cancelled rather than sent.
- Helmet sets security headers. JSON body size is limited to 32 KiB. Strict Zod mutation schemas reject unexpected fields; parameterized Prisma queries prevent SQL injection. User-supplied text renders as React text, never HTML. Production errors are generic; log output omits request content and database connection strings.
- No public registration. Local fictional accounts require explicit opt-in and a supplied password; production rejects both seed activation and demo-account login. `.env` is ignored, excluded from Docker context and excluded from source delivery archive. Production origin must be HTTPS.

## Phase 3 additions — AI

- **The model is given no tools.** There is no shell, no database access, no mail, no file access and no network destination other than the single configured provider endpoint. Every AI call is one request in, validated text out. Text is not code here: a model response can populate a screen, and nothing else.
- **Human approval gates every effect.** Triage suggestions change nothing. Applying one is a separate authenticated request that re-checks the role, revalidates the values against the database, enforces the optimistic version, compares a content fingerprint, and writes an audit record naming the accepting engineer. Reply drafts are sent only through the ordinary reply endpoint, by a person.
- **Permission filtering happens before retrieval, not after generation.** Article visibility and status are conditions inside the ranking query, so a support-only, draft or archived passage is never a candidate and never enters a prompt. The application does not rely on the model to withhold something it was shown. Citations are then revalidated against current rows before the answer is returned, so an article restricted between retrieval and response is dropped.
- **Citation identifiers are server-side.** The model sees per-request passage numbers, never database identifiers, and may only cite numbers it was supplied. Invented or out-of-range numbers are discarded rather than rendered as sources.
- **No answer history is persisted.** Storing answers would create records that outlive the permissions of their sources unless revocation were implemented, so this phase deliberately keeps nothing. The usage log holds operational metadata only — user, operation, provider, model, tokens, duration, outcome — and never a prompt, ticket body, article text, question or generated answer.
- **The provider endpoint is fixed.** There is no base-URL setting, so configuration cannot redirect the provider to another host. The key is server-side only, is refused at startup if set in a non-OpenAI mode, and never appears in a response, a log line, an error message or the administrator screen.
- **Bounded by construction.** Per-call timeout, bounded retries only for retryable conditions, a process-wide concurrency limit, hard input and output size caps, and a per-user rolling 24-hour request limit that also counts failures. Retries repeat a read-only provider call and can never duplicate an application action.
- **Untrusted input is fenced.** Ticket and article text is wrapped in explicit untrusted markers with a standing instruction not to obey embedded commands, and attempts to close the fence are neutralised. This reduces prompt injection; it does not eliminate it, and the structural controls above are what actually hold.

### AI limitations, stated plainly

Automated redaction is imperfect. It removes recognisable API keys, tokens, JWTs, private-key blocks, credentials in URLs, `password:`-style assignments, card numbers, email addresses and IP addresses — but pattern matching cannot recognise every secret, and an unusual internal token format or a password written as prose will pass through. Minimising what is sent, and telling users not to paste credentials into tickets, remain necessary.

Prompt-injection defence is not proven. The evaluation set includes injected instructions in both an article and a ticket, and asserts that restricted content is not disclosed and that no side effect occurs. Passing those cases shows the specific attacks tested were contained; it is not evidence that every future attack will be. The same applies to hallucination: answers are constrained to retrieved passages and cite them, which makes a wrong answer checkable, not impossible.

Mock mode is a deterministic stand-in, not a language model. A passing mock test proves the application's plumbing, permissions and validation are correct. It says nothing about the answer quality of a real model.

## Phase 5 additions — accounts, operations, governance

**Sign-in.** Five consecutive failures (password or second-factor code) lock the account for
fifteen minutes; both are configurable. The response for a wrong password, a locked account, a
disabled account and an unknown address is the same 401, so the endpoint does not confirm which
addresses exist. Every attempt is audited with the source address, including anonymous ones.

**Second factor.** TOTP per RFC 6238 (SHA-1, six digits, thirty seconds, ±1 step of drift), with
the step of the last accepted code stored so a code cannot be replayed inside its window. The secret
is generated server-side, shown once as a QR and a manual key, and stored encrypted with
AES-256-GCM under `APP_SECRET`; production refuses to start without that setting. Ten recovery codes
are issued at enrolment and stored hashed; each is deleted when used. A session between password
and second factor is a distinct *pending* state that can reach only the MFA endpoints, expires in
ten minutes, and is replaced by a fresh token on success — the browser never keeps a half-verified
token. `MFA_REQUIRED_ROLES` makes enrolment a precondition for a role; those users cannot turn it
off themselves. An administrator can remove a lost authenticator, which is audited and revokes the
person's sessions.

**Passwords.** At least twelve characters; refused if on the embedded common-password list (with
digits stripped), a single repeated character, a keyboard run, or containing the person's own email
or first name. The list is small and offline, and documented as such — it is not a breach check.
Accounts created by an administrator carry a temporary password that must be replaced at first
sign-in; nothing else works until it is. Changing a password revokes every other session. Reset links
are 32 random bytes, stored hashed, single use, thirty minutes when requested by the person and
twenty-four hours when issued by an administrator; using one revokes every session.

**Sessions.** Server-side, listable, individually revocable, with source address and user agent
recorded and last-seen updated at most every five minutes. Lifetime is `SESSION_HOURS`.

**Operations.** Request logs carry a correlation id and never a body, query string, cookie or
content. `/metrics` is disabled unless a bearer token is configured and is refused at the TLS edge
in the production compose. Readiness goes red before the listener closes. The production image
runs unprivileged on a read-only filesystem with all capabilities dropped, no host ports, and the
database on an internal network with no internet access. `trust proxy` is exactly one hop.

**Governance.** Personal-data export for oneself and by an administrator; erasure that removes
identifiers and credentials while keeping attributed operational records; a daily retention job
that never prunes ticket-bound audit events; a streamed audit export. Each of these is itself an
audited action.

## Explicit limitations

Phase 2 is a local portfolio project, not a claim of production certification. Password reset, MFA, retention and audit export arrived in Phase 5. SSO, fine-grained tenant isolation, account-level *distributed* throttling (the limiter and lockout counters are per process and per database respectively), security monitoring beyond the metrics endpoint, and external immutable audit logs remain hardening work. Audit records are protected by the absence of write endpoints and by application-level access control; anyone with direct database credentials can still modify them, so this is not tamper-proof logging. The background worker runs in-process, so a crash between the SLA scan and delivery simply retries on the next tick rather than losing a message — but there is no dead-letter alerting beyond the administrator outbox view. Administrator user management covers creation, activation, role changes, lockout, second-factor reset, reset links, export and erasure. Attachments have authorization, private storage, download-only headers and type/size/magic-byte checks (see above); there is no malware scanning.

The database's Docker password is an openly documented **local-only sample**, and its host port binds loopback. It must not be reused on a network deployment. Production bootstrap, a TLS proxy and secrets management are not provisioned. The API listens on all interfaces for container compatibility; use a local firewall during development.

Phase 3 connects a model. The controls listed above — permission-scoped retrieval before any model call, secret redaction, schema-validated structured results, server-verified source citations, explicit human review before any change, and no command execution — are implemented and tested. They reduce risk; they do not make the system immune. Treat model output as a suggestion from an unverified source, which is exactly how the interface presents it.
