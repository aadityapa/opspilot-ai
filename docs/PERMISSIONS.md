# Permission matrix

Generated from `tests/permissions.test.ts`, which checks every row against the running API and fails
if the server registers a route that is not listed here. ✓ means the role may reach the endpoint;
— means 403. Every endpoint below returns 401 without a session. Public endpoints (`POST /auth/login`,
`POST /auth/forgot`, `POST /auth/reset`, the health probes) need no session.

"May reach" is authorisation, not visibility: an employee may call `GET /tickets` but sees only
their own; `GET /articles` returns only what the role may read; `POST /ai/ask` retrieves only
from articles the caller could open. Those filters are tested in their own suites.

## Session and account

| Endpoint | Employee | Engineer | Administrator |
| --- | :-: | :-: | :-: |
| `GET /auth/me` | ✓ | ✓ | ✓ |
| `GET /auth/sessions` | ✓ | ✓ | ✓ |
| `DELETE /auth/sessions/:id` | ✓ | ✓ | ✓ |
| `POST /auth/sessions/revoke-others` | ✓ | ✓ | ✓ |
| `POST /auth/password` | ✓ | ✓ | ✓ |
| `POST /auth/mfa/setup` | ✓ | ✓ | ✓ |
| `POST /auth/mfa/enable` | ✓ | ✓ | ✓ |
| `POST /auth/mfa/verify` | ✓ | ✓ | ✓ |
| `POST /auth/mfa/disable` | ✓ | ✓ | ✓ |
| `POST /auth/mfa/recovery-codes` | ✓ | ✓ | ✓ |
| `GET /auth/export` | ✓ | ✓ | ✓ |
| `PATCH /auth/profile` | ✓ | ✓ | ✓ |

## Tickets, board and dashboard

| Endpoint | Employee | Engineer | Administrator |
| --- | :-: | :-: | :-: |
| `GET /tickets` | ✓ | ✓ | ✓ |
| `POST /tickets` | ✓ | ✓ | ✓ |
| `GET /tickets/:id` | ✓ | ✓ | ✓ |
| `PATCH /tickets/:id` | — | ✓ | ✓ |
| `POST /tickets/:id/replies` | ✓ | ✓ | ✓ |
| `POST /tickets/:id/reopen` | ✓ | ✓ | ✓ |
| `GET /tickets/:id/notes` | — | ✓ | ✓ |
| `POST /tickets/:id/notes` | — | ✓ | ✓ |
| `GET /tickets/:id/events` | — | ✓ | ✓ |
| `GET /dashboard` | ✓ | ✓ | ✓ |
| `GET /categories` | ✓ | ✓ | ✓ |
| `GET /engineers` | — | ✓ | ✓ |
| `GET /board` | ✓ | ✓ | ✓ |
| `POST /board/move` | — | ✓ | ✓ |
| `POST /tickets/bulk` | — | ✓ | ✓ |
| `GET /views` | ✓ | ✓ | ✓ |
| `POST /views` | ✓ | ✓ | ✓ |
| `DELETE /views/:id` | ✓ | ✓ | ✓ |
| `GET /labels` | ✓ | ✓ | ✓ |
| `GET /search` | ✓ | ✓ | ✓ |
| `GET /events/stream` | ✓ | ✓ | ✓ |
| `POST /tickets/:id/approvals/${ID}/decide` | ✓ | ✓ | ✓ |
| `POST /tickets/:id/watch` | ✓ | ✓ | ✓ |
| `DELETE /tickets/:id/watch` | ✓ | ✓ | ✓ |
| `POST /tickets/:id/watchers` | — | ✓ | ✓ |
| `POST /tickets/:id/attachments` | ✓ | ✓ | ✓ |
| `GET /tickets/:id/attachments/${ID}` | ✓ | ✓ | ✓ |
| `DELETE /tickets/:id/attachments/${ID}` | ✓ | ✓ | ✓ |
| `PATCH /tickets/:id/replies/${ID}` | ✓ | ✓ | ✓ |
| `GET /tickets/:id/activity` | ✓ | ✓ | ✓ |
| `GET /tickets/:id/mentionable` | ✓ | ✓ | ✓ |
| `POST /tickets/:id/survey` | ✓ | ✓ | ✓ |

## Service catalog, templates and approvals

| Endpoint | Employee | Engineer | Administrator |
| --- | :-: | :-: | :-: |
| `GET /catalog` | ✓ | ✓ | ✓ |
| `GET /catalog/:id` | ✓ | ✓ | ✓ |
| `GET /templates` | ✓ | ✓ | ✓ |
| `GET /approvals` | ✓ | ✓ | ✓ |

## Assets

| Endpoint | Employee | Engineer | Administrator |
| --- | :-: | :-: | :-: |
| `GET /assets` | ✓ | ✓ | ✓ |
| `GET /assets/:id` | ✓ | ✓ | ✓ |
| `POST /assets` | — | — | ✓ |
| `PATCH /assets/:id` | — | — | ✓ |

## Knowledge base

| Endpoint | Employee | Engineer | Administrator |
| --- | :-: | :-: | :-: |
| `GET /articles` | ✓ | ✓ | ✓ |
| `GET /articles/:id` | ✓ | ✓ | ✓ |
| `POST /articles` | — | — | ✓ |
| `PUT /articles/:id` | — | — | ✓ |

## People and organisation

| Endpoint | Employee | Engineer | Administrator |
| --- | :-: | :-: | :-: |
| `GET /people` | ✓ | ✓ | ✓ |
| `GET /people/:id` | ✓ | ✓ | ✓ |
| `GET /departments` | ✓ | ✓ | ✓ |
| `GET /announcements` | ✓ | ✓ | ✓ |
| `GET /reports` | — | ✓ | ✓ |
| `GET /operations/summary` | — | ✓ | ✓ |
| `GET /analytics` | — | ✓ | ✓ |
| `GET /reports/:kind` (JSON and `?format=csv`) | — | ✓ | ✓ |

## Notifications

| Endpoint | Employee | Engineer | Administrator |
| --- | :-: | :-: | :-: |
| `GET /notifications` | ✓ | ✓ | ✓ |
| `GET /notifications/unread` | ✓ | ✓ | ✓ |
| `POST /notifications/read` | ✓ | ✓ | ✓ |
| `GET /notifications/preferences` | ✓ | ✓ | ✓ |
| `PUT /notifications/preferences` | ✓ | ✓ | ✓ |

## AI assistance

| Endpoint | Employee | Engineer | Administrator |
| --- | :-: | :-: | :-: |
| `GET /ai/status` | ✓ | ✓ | ✓ |
| `POST /ai/ask` | ✓ | ✓ | ✓ |
| `POST /ai/tickets/:id/analyze` | — | ✓ | ✓ |
| `POST /ai/tickets/:id/apply-triage` | — | ✓ | ✓ |
| `POST /ai/tickets/:id/summary` | — | ✓ | ✓ |
| `POST /ai/tickets/:id/draft-reply` | — | ✓ | ✓ |

## Administration

| Endpoint | Employee | Engineer | Administrator |
| --- | :-: | :-: | :-: |
| `GET /admin/catalog` | — | — | ✓ |
| `POST /admin/catalog` | — | — | ✓ |
| `PUT /admin/catalog/:id` | — | — | ✓ |
| `GET /admin/templates` | — | — | ✓ |
| `POST /admin/templates` | — | — | ✓ |
| `PUT /admin/templates/:id` | — | — | ✓ |
| `PATCH /admin/users/:id/profile` | — | — | ✓ |
| `POST /admin/departments` | — | — | ✓ |
| `PUT /admin/departments/:id` | — | — | ✓ |
| `DELETE /admin/departments/:id` | — | — | ✓ |
| `GET /admin/announcements` | — | — | ✓ |
| `POST /admin/announcements` | — | — | ✓ |
| `PUT /admin/announcements/:id` | — | — | ✓ |
| `DELETE /admin/announcements/:id` | — | — | ✓ |
| `GET /admin/users` | — | — | ✓ |
| `POST /admin/users` | — | — | ✓ |
| `PATCH /admin/users/:id` | — | — | ✓ |
| `POST /admin/users/:id/unlock` | — | — | ✓ |
| `POST /admin/users/:id/revoke-sessions` | — | — | ✓ |
| `POST /admin/users/:id/mfa-reset` | — | — | ✓ |
| `POST /admin/users/:id/reset-link` | — | — | ✓ |
| `GET /admin/users/:id/export` | — | — | ✓ |
| `POST /admin/users/:id/erase` | — | — | ✓ |
| `GET /admin/audit` | — | — | ✓ |
| `GET /admin/audit/export` | — | — | ✓ |
| `GET /admin/retention` | — | — | ✓ |
| `POST /admin/retention/run` | — | — | ✓ |
| `GET /admin/erasure-policy` | — | — | ✓ |
| `GET /admin/security` | — | — | ✓ |
| `GET /admin/outbox` | — | — | ✓ |
| `POST /admin/outbox/:id/retry` | — | — | ✓ |
| `GET /admin/sla` | — | — | ✓ |
| `PUT /admin/sla/:priority` | — | — | ✓ |
| `GET /admin/ai/index` | — | — | ✓ |
| `GET /admin/ai/usage` | — | — | ✓ |
| `POST /admin/ai/reindex` | — | — | ✓ |

## Organisational information (Phase 4)

| Surface | Employee | Engineer | Administrator |
| --- | --- | --- | --- |
| People directory and profiles | Sees every active colleague's name, title, department, manager and contact details | Same | Same, plus editing |
| A person's tickets and assets | Own profile only | Any profile | Any profile |
| A person's assigned queue | Not shown | Shown | Shown |
| Department directory | Name, code, cost centre, manager, headcount | Same, plus open and 30-day ticket counts | Same |
| Department service demand (active, unassigned, at risk, breached, work type, recent work) | Denied — it is `GET /operations/summary`, which employees may not call | Allowed | Allowed |
| Asset inventory | Only assets they own | Unassigned assets, their own, and assets involved in tickets they can reach | Everything |
| Asset service history | Only the tickets that person raised | All tickets on the asset | All |
| Knowledge | Published, employee-visible articles | Published articles including support runbooks | Everything, including drafts |
| Article feedback | May rate any article they may read | Same | Same |
| Search and command palette | Own tickets and assets, employee-visible articles, directory, departments, catalog services | Wider ticket and asset scope, support articles | Everything |

The directory is deliberately open to employees: it is the company phone book, and it carries no
ticket, asset or approval information for anybody but the viewer. Everything operational sits
behind the same role checks the rest of the API uses.

## Session states that override the matrix

| State | May call |
| --- | --- |
| Password accepted, second factor pending | `GET /auth/me`, `POST /auth/mfa/verify`, `POST /auth/logout` — everything else 403 |
| Password accepted, enrolment required by `MFA_REQUIRED_ROLES` | `GET /auth/me`, `POST /auth/mfa/setup`, `POST /auth/mfa/enable`, `POST /auth/logout` |
| `mustChangePassword` | `/auth/*` only, until `POST /auth/password` succeeds |
| Account disabled, erased, or session expired | nothing — 401 |

## Role summary

- **Employee** — raises and follows their own tickets, requests from the catalog, decides approvals
  addressed to them, sees their own board, assets and notifications, reads employee-visible
  articles, asks the AI, uses the directory, manages their own account, profile and data.
- **IT engineer** — everything an employee can, plus the whole queue and board (moving cards, bulk
  actions, shared views), ticket updates and classification, internal notes and audit timeline,
  adding followers, support-only articles, reports, and AI ticket assistance.
- **Administrator** — everything an engineer can, plus users, roles, profiles and departments,
  lockouts, second-factor resets, reset links, the service catalog, templates and announcements,
  assets and knowledge authoring, SLA policy, the notification outbox, AI settings and index, the
  audit log and its export, personal-data export and erasure, retention.

An *approver* is not a role: any person named on a pending approval can open that one request and
decide it, whatever their role.
