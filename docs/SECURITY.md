# Security decisions

- Passwords use Node's asynchronous scrypt, N=131072, r=8, p=1, 16 random salt bytes, 64-byte derived key, 256 MiB max memory. Hash comparisons are timing-safe. Unknown-account login also computes a dummy hash. Login is capped at `LOGIN_RATE_LIMIT` attempts per IP per 15 minutes (default 20). It is raised only where many people legitimately share one address, or for the automated browser suite; the production default is unchanged. This process-local limiter is suitable for one API instance; distributed deployments need a shared store and trusted proxy configuration.
- Session tokens are 32 random bytes. Only SHA-256 token hashes are stored in PostgreSQL. Sessions expire absolutely after eight hours. Login rotates the browser's previous session; logout deletes it. Active role/account status is read on every request. Disabling a user revokes sessions transactionally.
- Cookies use HttpOnly, SameSite=Strict, path `/`, and no Domain. Production adds Secure and the `__Host-` prefix. Never put session tokens or API credentials into localStorage. The browser stores only theme preference there.
- Exact Origin checks cover login and every mutation; authenticated mutations also require a per-session random synchronizer token in a custom header. CORS is restricted to one configured origin. Missing Origin is rejected even for CLI clients; send it explicitly.
- Backend access checks precede ticket detail/reply/reopen operations. Ticket list and dashboard scope are enforced in the query. Staff privileges are required for changes. Non-owners get the same 404 as nonexistent records. Public reply reads filter `internal=false`. No attachment routes or storage exist.
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

Phase 2 is a local portfolio project, not a claim of production certification. Password reset, MFA, retention and audit export arrived in Phase 5. SSO, fine-grained tenant isolation, account-level *distributed* throttling (the limiter and lockout counters are per process and per database respectively), security monitoring beyond the metrics endpoint, and external immutable audit logs remain hardening work. Audit records are protected by the absence of write endpoints and by application-level access control; anyone with direct database credentials can still modify them, so this is not tamper-proof logging. The background worker runs in-process, so a crash between the SLA scan and delivery simply retries on the next tick rather than losing a message — but there is no dead-letter alerting beyond the administrator outbox view. Administrator user management covers creation, activation, role changes, lockout, second-factor reset, reset links, export and erasure. There is no attachment handling or malware scanning. Uploads must stay disabled until authorization, private storage, safe content-disposition/download headers, type/size checks and scanning decisions are implemented.

The database's Docker password is an openly documented **local-only sample**, and its host port binds loopback. It must not be reused on a network deployment. Production bootstrap, a TLS proxy and secrets management are not provisioned. The API listens on all interfaces for container compatibility; use a local firewall during development.

Phase 3 connects a model. The controls listed above — permission-scoped retrieval before any model call, secret redaction, schema-validated structured results, server-verified source citations, explicit human review before any change, and no command execution — are implemented and tested. They reduce risk; they do not make the system immune. Treat model output as a suggestion from an unverified source, which is exactly how the interface presents it.
