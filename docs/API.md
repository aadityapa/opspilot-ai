# API reference

Base path `/api`. JSON request/response bodies. All routes except the health probes, login, forgot and reset require the server session cookie. Every mutation requires exact `Origin: APP_ORIGIN`; authenticated mutations additionally require `X-CSRF-Token`, returned by login or `/auth/me`. Cookies must be retained. GET responses use `Cache-Control: no-store`.

"Scoped" means the response is filtered by the caller's role: employees see only their own records, engineers and administrators see the workspace. Authorization is always evaluated on the server — a hidden button is not a permission.

Paginated list endpoints accept `q`, `page` and `pageSize` (1–100, default 15) and return `{ items, total, page, pageSize }`.

## Health and operations

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/health` | Public | `{status:"ok"}` after a database query (kept from Phase 1) |
| GET | `/health/live` | Public | Liveness; never touches the database |
| GET | `/health/ready` | Public | 200 `{status:"ready",checks}` or 503; checks database, migrations, shutdown state |
| GET | `/metrics` (no `/api` prefix) | Bearer `METRICS_TOKEN` | Prometheus text format; 404 when the token is unset — see [OPERATIONS.md](OPERATIONS.md) |

Every response carries `X-Request-Id`; a well-formed incoming `X-Request-Id` is honoured. 500 responses include `requestId`.

## Authentication

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| POST | `/auth/login` | Public, rate limited | `{email,password}` → cookie plus one of: `{user,csrfToken,mustChangePassword,mfaEnabled}`; `{user:null,csrfToken,mfaRequired:true}`; `{user:null,csrfToken,mfaEnrollmentRequired:true,account}`. Wrong credentials, a locked or disabled account and an unknown address all answer the same 401 |
| GET | `/auth/me` | Session (including pending) | Same shape as login |
| POST | `/auth/logout` | Session | `{}` → 204; deletes the server session |
| POST | `/auth/forgot` | Public, rate limited | `{email}` → 202 with the same body whether or not the address exists. Emails a 30-minute link when `MAIL_MODE=mailpit`; otherwise an administrator issues one |
| POST | `/auth/reset` | Public, rate limited | `{token,password}` → 200; single use; revokes every session; policy applies |
| POST | `/auth/password` | Session | `{currentPassword,newPassword}` → 200; clears `mustChangePassword`; revokes other sessions |
| POST | `/auth/mfa/setup` | Session | `{}` → `{secret,otpauth}` (a pending secret; nothing is enforced yet) |
| POST | `/auth/mfa/enable` | Session (including enrolment-pending) | `{code}` → `{recoveryCodes:[…10],user,csrfToken,…}`; a pending session is replaced by a full one |
| POST | `/auth/mfa/verify` | Pending session | `{code}` — six digits (±1 step, no replay) or a recovery code (single use) → full session with a **new** cookie and CSRF token. Failures count towards lockout |
| POST | `/auth/mfa/disable` | Session | `{password,code}` → 200; refused for roles in `MFA_REQUIRED_ROLES` |
| POST | `/auth/mfa/recovery-codes` | Session | `{code}` → ten new codes; the old ones stop working |
| GET | `/auth/sessions` | Session | `[{id,createdAt,lastSeenAt,ip,userAgent,expiresAt,current}]` — never token hashes |
| DELETE | `/auth/sessions/:id` | Session | 204; revoking the current one clears the cookie |
| POST | `/auth/sessions/revoke-others` | Session | `{}` → `{revoked}` |
| GET | `/auth/export` | Session | Personal-data export as a JSON download — see [GOVERNANCE.md](GOVERNANCE.md) |

A session between password acceptance and second-factor verification is *pending*: it may call only `/auth/me`, the MFA endpoints and `/auth/logout`, and expires in ten minutes. A session flagged `mustChangePassword` may call only `/auth/*`.

## Reference data

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/categories` | Signed in | Array of `{id,name}` |
| GET | `/engineers` | Staff | Active engineers/admins: `{id,name,role}[]` |

## Tickets

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/tickets` | Scoped | Filters `q`, `status`, `priority`, `type`, `categoryId`, `label`, `assigned` (`mine`/`unassigned`), `assigneeId`, `requesterId` (staff), `watching`, `open=true` (active statuses only), `sla` (`at-risk`/`breached`/`healthy`, computed from the live SLA position so the page and total are exact), `sort` (`newest`/`oldest`/`updated`), `page`, `pageSize`. Each item carries an `sla` view or `null` |
| POST | `/tickets` | Signed in | `{title,description,categoryId,priority?,assetId?}` → 201 ticket. Creates the SLA record from the current policy snapshot |
| GET | `/tickets/:id` | Owner or staff | Ticket plus public `replies` with safe author fields, plus `sla`. Returns 404 — not 403 — to a non-owner, so IDs are not confirmed |
| PATCH | `/tickets/:id` | Staff | `{version,status?,priority?,categoryId?,assigneeId?,assetId?}` → updated ticket. Advances the SLA clock and queues an assignment notification when the assignee changes |
| POST | `/tickets/:id/replies` | Owner or staff | `{body}` → 201 public reply. A staff reply that is not from the requester satisfies the first-response target |
| POST | `/tickets/:id/reopen` | Owner or staff | `{}` → ticket in Open; resumes the resolution clock and keeps breach history |

An employee who is not the asset's owner receives the ticket with `asset` and `assetId` set to `null`, so an asset transfer immediately removes visibility of the link.

## Internal notes and audit

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/tickets/:id/notes` | Staff | Internal notes with author. Employees receive 403 |
| POST | `/tickets/:id/notes` | Staff | `{body}` → 201. Does **not** satisfy the first-response SLA target |
| GET | `/tickets/:id/events` | Staff | Full audit timeline for the ticket, oldest first |
| GET | `/admin/audit` | Admin | Paginated workspace audit log; `q` matches action or detail |

Audit records are written inside the same transaction as the change they describe. No endpoint updates or deletes them.

## Assets

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/assets` | Scoped | Filters `status`, `type`, `ownerId` (or `none`), `departmentId`, `warranty` (`expiring`/`expired`), `sort` (`tag`/`updated`/`warranty`). `q` matches tag, model, manufacturer, serial and owner name. Employees see only assets they own |
| GET | `/assets/summary` | Scoped | Inventory totals over the same filter as the list: `total`, `assigned`, `unassigned`, `attention`, `retired`, `byStatus`, `byType`, `warrantyExpiring90Days` |
| GET | `/assets/:id` | Scoped | Asset with owner and the related tickets the caller may open |
| POST | `/assets` | Admin | Full asset body → 201. Duplicate tag returns 409 |
| PATCH | `/assets/:id` | Admin | `{version,asset:{…}}` → updated asset; stale `version` returns 409 |

`type` is one of `LAPTOP`, `DESKTOP`, `ACCESS_POINT`, `PRINTER`, `SWITCH`. `status` is one of `IN_USE`, `AVAILABLE`, `REPAIR`, `RETIRED`. Dates are `YYYY-MM-DD` or `null`; warranty expiry may not precede the purchase date. An owner must be an active employee. Linking a ticket to an asset the caller cannot access returns 404, as does linking an asset that belongs to a different requester.

## Service levels

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/admin/sla` | Admin | Current policy per priority |
| PUT | `/admin/sla/:priority` | Admin | `{responseMinutes,resolutionMinutes}` → updated policy; writes an audit record |

Policy changes apply to tickets created afterwards. Existing tickets keep the snapshot stored on their own SLA record.

The `sla` object returned with a ticket contains the snapshot (`responseMinutes`, `resolutionMinutes`, `priority`), the absolute timestamps (`startedAt`, `responseDueAt`, `responseSatisfiedAt`, `responseBreachAt`, `resolutionBreachAt`, `resolutionDueAt`), the live derived values (`elapsedMs`, `remainingResponseMs`, `remainingResolutionMs`), the state flags (`paused`, `stopped`, `legacyBackfill`) and `asOf`, the server time the view was computed.

## Knowledge base

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/articles` | Scoped | Filters `categoryId`, `status` (administrators only in practice). `q` matches title and body |
| GET | `/articles/:id` | Scoped | Article plus server-sanitized `html` and `feedback` (`helpful`, `notHelpful`, `mine`) |
| POST | `/articles/:id/feedback` | Scoped | `{helpful}` → updated counts. One row per person per article, changeable. An article the caller may not read returns 404 |
| GET | `/knowledge/overview` | Scoped | Category counts, recently updated and most-helpful sets, all under the caller's own visibility |
| POST | `/articles` | Admin | `{title,markdown,categoryId,visibility,status}` → 201 |
| PUT | `/articles/:id` | Admin | `{version,article:{…}}` → updated article; stale `version` returns 409 |

Article helpfulness is a count of named votes, never a score: an article nobody has voted on reports zeros, and the interface says so rather than showing a percentage.

`visibility` is `EMPLOYEE` or `SUPPORT`; `status` is `DRAFT`, `PUBLISHED` or `ARCHIVED`. Employees see only `PUBLISHED` + `EMPLOYEE`. Engineers see all `PUBLISHED` articles. Administrators see everything. The same filter is applied to search, so restricted text never appears in a result set or a total count. Rendered HTML allows a fixed tag list only; scripts, inline event handlers and non-`http(s)` link schemes are removed.

## Notifications

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/notifications` | Signed in | The caller's own queued messages with fixed template text |
| GET | `/admin/outbox` | Admin | Delivery monitor: status, attempts, last error |
| POST | `/admin/outbox/:id/retry` | Admin | `{}` → 204. Only `FAILED` jobs may be retried; anything else returns 409 |

Notification bodies are fixed templates naming the ticket number. They never quote ticket content, reply text or internal notes. Retrying reuses the existing outbox row, so it cannot create a duplicate entry or a duplicate message.

## AI assistance

Every route below re-checks the caller's role and the specific record. When `AI_MODE=disabled` each returns **503** and the rest of the API is unaffected.

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/ai/status` | Signed in | Mode, models, per-user limit and usage. Never returns a credential |
| POST | `/ai/tickets/:id/analyze` | Staff | `{}` → triage suggestions plus `ticketVersion` and `fingerprint`. Changes nothing |
| POST | `/ai/tickets/:id/apply-triage` | Staff | `{version,fingerprint,categoryId?,priority?}` → applies a reviewed suggestion and audits it |
| POST | `/ai/tickets/:id/summary` | Staff | `{}` → internal conversation summary. Never shown to a requester |
| POST | `/ai/tickets/:id/draft-reply` | Staff | `{}` → editable draft built from public material only. Sends nothing |
| POST | `/ai/ask` | Signed in | `{question}` → answer with verified citations, or an insufficient-evidence result |
| GET | `/admin/ai/index` | Admin | Per-article index state, chunk counts, and whether pgvector is installed |
| POST | `/admin/ai/reindex` | Admin | `{articleId?}` → reindex one article or every published article |
| GET | `/admin/ai/usage` | Admin | Measured token and duration totals for the last 7 days. Reports no monetary cost |

**Triage never writes.** `analyze` returns `suggestedCategory` as text plus `suggestedCategoryId` and `suggestedCategoryMatched`; an unrecognised category name cannot be applied. `apply-triage` returns **409** when `version` has moved on or when `fingerprint` no longer matches the ticket's current title, description and status — the engineer must analyse again. It returns **400** for an unknown category, an invalid priority, or a request that selects nothing.

**Drafts never send.** `draft-reply` reads the description and public replies only; internal notes are excluded at the query. The response carries `sourceScope: "public"` and a review note. Posting the reply is a separate call to `POST /tickets/:id/replies`.

**Answers cite verified sources.** `ask` embeds the question, retrieves passages the caller may read (published only, and employee-visible only for employees), and asks the model to cite the passage numbers it used. Numbers it was not given are discarded, and every surviving citation is re-checked against current visibility before the response is built. When `sufficientEvidence` is `false`, `answer` is empty, `citations` is empty, and `escalationAdvice` explains what to do instead. Nothing about an answer is persisted.

### AI-specific status codes

| Status | Meaning |
| --- | --- |
| 429 | The caller's rolling 24-hour AI usage limit is exhausted |
| 503 | `AI_MODE=disabled`, so the feature is switched off |
| 504 | The provider did not respond within `AI_TIMEOUT_MS` |
| 502 | The provider failed, refused, or returned output that did not match the required structure |


## Administration

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/admin/users` | Admin | Non-erased users: `{id,name,email,role,active,mfaEnabled,lockedUntil,lastLoginAt,mustChangePassword,createdAt}`; never hashes or secrets |
| POST | `/admin/users` | Admin | `{name,email,role,password}` → 201; policy applies; the account starts with `mustChangePassword` |
| PATCH | `/admin/users/:id` | Admin | `{active?,role?}` → user; disabling or changing role deletes that user's sessions; cannot remove own access |
| POST | `/admin/users/:id/unlock` | Admin | 204; clears lockout and failure count |
| POST | `/admin/users/:id/revoke-sessions` | Admin | `{}` → `{revoked}` |
| POST | `/admin/users/:id/mfa-reset` | Admin | 204; removes the authenticator and recovery codes, revokes sessions; not for oneself |
| POST | `/admin/users/:id/reset-link` | Admin | `{}` → `{link,expiresInHours:24}`; one-time, shown once |
| GET | `/admin/users/:id/export` | Admin | Personal-data export for that account |
| POST | `/admin/users/:id/erase` | Admin | `{confirmEmail}` → `{erased,at,removed,retained}`; irreversible — see [GOVERNANCE.md](GOVERNANCE.md) |
| GET | `/admin/audit` | Admin | Paginated audit log |
| GET | `/admin/audit/export` | Admin | `?format=csv|json&from&to&action` → streamed download; audited |
| GET | `/admin/retention` | Admin | Policy and counts of what would be removed |
| POST | `/admin/retention/run` | Admin | `{}` → counts removed; audited |
| GET | `/admin/erasure-policy` | Admin | What erasure removes and retains |
| GET | `/admin/security` | Admin | Security posture: `policy {sessionHours,lockoutThreshold,lockoutMinutes,loginRateLimitPer15Min,mfaRequiredRoles,passwordMinLength,secureCookies,environment}` and `accounts {total,mfaEnabled,locked,mustChangePassword,disabled,activeSessions}`; read from configuration and stored rows, never a secret |

## Service Intelligence and reports (V2 Phase 5)

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/analytics` | Staff | `?days=7..365&departmentId&type&priority` → `{window, headline, series, demand, sla, resolution, csat, team}`. `headline` carries six `Comparison {value, previous, delta, measured}` objects; `delta` is `null` when either period has no value. `series` is one row per day (`created, resolved, backlog, slaPercent|null, slaMeasured, csat|null, csatResponses, mttrMinutes|null, breaches`). `team` is alphabetical and carries no rank |
| GET | `/reports/:kind` | Staff | `kind` ∈ `tickets, sla, resolution, csat, requests, departments, agents, assets`; same filters → `{kind, title, description, window, filters, summary:[{label,value}], columns:[{key,label,align?}], rows}`; `?format=csv` → `text/csv` attachment `opspilot-<kind>-<days>d-<date>.csv` (UTF-8 BOM, RFC 4180 quoting) containing exactly the filtered rows; unknown kinds 404 |

## Workspace (Phase 6)

Full behaviour in [WORKSPACE.md](WORKSPACE.md); authorisation per row in [PERMISSIONS.md](PERMISSIONS.md).

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/board` | Scoped | `?q&type&priority&assigned&label&categoryId&includeClosed` → `{columns:[{status,tickets,total}],labels}`; tickets carry `sla`, `attachmentCount`, `replyCount` |
| POST | `/board/move` | Staff | `{id,status,afterId}` → ticket; workflow rules apply; `afterId:null` places first |
| POST | `/tickets/bulk` | Staff | `{ids[≤100],status?,priority?,assigneeId?,categoryId?,addLabels?,removeLabels?}` → `{updated,skipped:[{id,reason}]}` |
| GET/POST/DELETE | `/views`, `/views/:id` | Signed in | Saved filter sets; `shared` requires staff; upsert by name |
| GET | `/labels` | Scoped | `[{label,count}]` |
| GET | `/search` | Scoped | `?q` → `{tickets,assets,articles,people}` (≤ 6/5/5/5) |
| GET | `/events/stream` | Signed in | Server-sent events: `notification`, `ticket`, `approval`, `announcement` hints |
| GET | `/catalog`, `/catalog/:id` | Signed in | Active items with `fields` schema |
| GET/POST/PUT | `/admin/catalog[/:id]` | Admin | Item with `fields`, `requiresApproval`, `approverKind`, `approverDepartmentId` |
| GET | `/templates`; `/admin/templates` (+POST/PUT) | Signed in; Admin | Ticket templates |
| POST | `/tickets` | Signed in | Now also `type,impact,urgency,labels,dueAt,catalogItemId,formData,templateId`; priority derives from the matrix or the catalog item unless given |
| PATCH | `/tickets/:id` | Staff | Now also `type,impact,urgency,labels,dueAt,title` |
| GET | `/approvals` | Signed in | `?status`, `?scope=approver` (default: approvals where the caller is the approver) or `?scope=requester` (approvals on tickets the caller raised); each row includes `approver` |
| POST | `/tickets/:id/approvals/:approvalId/decide` | Approver or admin | `{decision:'APPROVED'|'REJECTED',note?}`; once |
| POST/DELETE | `/tickets/:id/watch` | Can read | Follow / unfollow |
| POST | `/tickets/:id/watchers` | Staff | `{userId}` — must already be able to read the ticket |
| POST | `/tickets/:id/attachments` | Can read | multipart `file`; allow-listed types, magic bytes, ≤ `ATTACHMENT_MAX_MB` → 201 |
| GET | `/tickets/:id/attachments/:attachmentId` | Can read | Always `Content-Disposition: attachment`, `nosniff`, sandbox CSP |
| DELETE | `/tickets/:id/attachments/:attachmentId` | Uploader or admin | 204 |
| PATCH | `/tickets/:id/replies/:replyId` | Author | `{body}`; fifteen-minute window for employees |
| GET | `/tickets/:id/activity` | Can read | Unified stream; internal entries removed for employees |
| GET | `/tickets/:id/mentionable` | Can read | `?q` → people who can read the ticket |
| POST | `/tickets/:id/survey` | Requester | `{score 1–5,comment?}` after resolution, once |
| GET | `/people`, `/people/:id` | Signed in | Directory (`?q&departmentId`), profile with reports; open tickets and assets for staff or self |
| PATCH | `/auth/profile` | Signed in | `{title,location,phone}` only |
| PATCH | `/admin/users/:id/profile` | Admin | plus `departmentId`, `managerId` |
| GET | `/departments`; `/admin/departments` (+POST/PUT/DELETE) | Signed in; Admin | Name, code, cost centre, manager, parent, member count; cannot delete with members |
| GET | `/announcements`; `/admin/announcements` (+POST/PUT/DELETE) | Signed in; Admin | Audience `ALL` or `STAFF`, pinned, expiry |
| GET | `/reports` | Staff | `?days=7…365` → CSAT, per-day throughput, by type, agents, departments |
| GET | `/operations/summary` | Support roles | `?days=1..30` (default 7), `?departmentId` → command-center figures counted from stored rows: active/unassigned by priority with oldest ages, SLA at-risk (with < 30 min) and breached with oldest breach age, ticket flow per day with the previous window, MTTR, CSAT, pending approvals, per-department and per-engineer load, critical work, the last 20 ticket events, asset signals |
| GET | `/notifications` | Signed in | Now includes `unread` and each item's `readAt` |
| GET | `/notifications/unread`; POST `/notifications/read` | Signed in | `{unread}`; `{ids?}` → `{marked}` |
| GET/PUT | `/notifications/preferences` | Signed in | Seven booleans; approval requests are never silenced |

## Dashboard

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/dashboard` | Scoped | Ticket counts and breakdowns, `sla` metrics with explicit denominators, and an `assets` summary over the caller's authorized inventory |

Metric definitions are in the README. Every figure is computed from stored rows at request time.

## Errors

| Status | Meaning |
| --- | --- |
| 400 | Validation failure; `issues` lists field paths and messages |
| 401 | No valid session, or sign-in refused (credentials, lockout, disabled account — indistinguishable by design) |
| 403 | Wrong role, rejected `Origin`, failed CSRF check, a pending second factor, or a required password change |
| 404 | Record does not exist **or** the caller may not see it |
| 409 | Stale `version`, disallowed status transition, duplicate unique value, or an invalid state change |
| 413 | Request body over 32 kB |
| 429 | Login or reset-request rate limit |
| 500 | Unexpected failure; the body carries only `requestId`, which matches the server log line |
