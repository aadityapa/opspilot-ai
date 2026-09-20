# Enterprise redesign — change summary

The user interface was rebuilt on a centralised design system, first as a single pass (the table
directly below records that pass) and then screen by screen as "V2" in five phases. Backend changes
across the whole redesign are additive and are listed where they were made: one query parameter in
the first pass, the `ArticleFeedback` table and the knowledge/asset/people endpoints in V2 Phase 4,
and the `/analytics`, `/reports/:kind` and `/admin/security` read endpoints in V2 Phase 5. The
security model is unchanged. This document is the honest record of what changed, what was executed
to prove it, and what is still missing. **The final verification on the finished code is in the
"V2 Phase 5" section and the final report.**

## Verification actually executed (first redesign pass)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npm test` (Vitest API/unit suite) | **308 passed / 0 failed**, 17 files |
| `npm run test:e2e` (Playwright, Chromium) | **28 passed / 0 failed**, one run, after every phase |
| `npm run build` | clean; client bundle 443.6 kB JS (123.7 kB gzip), 72.9 kB CSS (14.1 kB gzip); previous build 737.9 kB JS |
| `npm audit` (all) and `npm audit --omit=dev` | 0 vulnerabilities |
| axe-core 4.10.3, tags `wcag2a wcag2aa wcag21a wcag21aa wcag22aa` | **0 violations** across sign-in + 19 routes × light and dark (39 page states) |
| Screenshots | captured from the running app with fictional seed data at 1440 × 1000 and 390 × 844; see `docs/screenshots/` |

The axe sweep ran from a temporary Playwright spec that signed in as an administrator, visited each
route in both themes and injected `axe.min.js`; the spec is not part of the repository because it
depends on a package that is not a project dependency. Reproduce it with `@axe-core/playwright` if
you want it in CI.

Not re-executed in this pass: the retrieval evaluation (`tests/eval`, unaffected by UI changes) and
the container verification script.

## Migrations

None. No schema change was needed. `scripts/upgrade-db.mjs` and `start.bat` behave exactly as before.

## Dependencies

None added, removed or upgraded. `package.json` and `package-lock.json` are untouched. Tailwind was
already installed but unused; its `@import` was dropped from `web/style.css`, which is why the client
bundle shrank. Inter and JetBrains Mono are loaded from Google Fonts with system fallbacks; the app is
fully usable offline with the fallback stack.

## API change (additive)

`GET /api/approvals?scope=requester` returns approvals on tickets the caller raised, so a requester can
follow their own request. The default (`scope=approver`) is unchanged. Both scopes now include the
`approver` person. Covered by new assertions in `tests/workspace.test.ts`. The permission matrix is
unchanged because the route is the same.

## Files

**New:** `web/ui/tokens.css`, `web/ui/base.css`, `web/ui/icons.tsx`, `web/ui/index.tsx`,
`web/app-shell.tsx`, `web/desk.tsx`, `web/departments.tsx`, `web/overview.tsx`, `web/admin-nav.tsx`,
`docs/DESIGN-SYSTEM.md`, this file.

**Rewritten:** `web/style.css` (every legacy class kept and restyled), `web/shell.tsx` (palette, bell,
profile menu, My Space), `index.html` (fonts, theme colour).

**Modified:** `web/main.tsx` (shell, routes, ticket workspace; old dashboard and list removed),
`web/board.tsx` (board is a view of the Service Desk), `web/catalog.tsx` (marketplace, stepped
request, Approval Center), `web/people.tsx`, `web/workspace-admin.tsx`, `web/admin.tsx`,
`web/users.tsx`, `server/workspace.ts` (the query parameter above), `tests/workspace.test.ts`,
`tests/e2e/*.spec.ts` (selector updates listed below), `README.md`, `docs/API.md`, `docs/WORKSPACE.md`.

## Browser-test edits (all legitimate UX changes; no assertion weakened, none deleted)

- Sign out moved into the account menu: tests open **Account menu** and click the **Sign out** menu item.
- Phone navigation is an off-canvas drawer: the mobile test asserts closed → **Open navigation** →
  visible → navigate → closed, then resizes to desktop and asserts the icon-rail collapse.
- The breadcrumb also links to "My tickets" from a ticket page, so one test scopes the click to the
  main navigation landmark.
- The catalog request flow has a review step: the test clicks **Review request**, checks the chosen
  model is echoed, then **Submit request**.

## What changed, by phase

1. **Audit.** Repo inspected: 5,639 lines of React across 17 modules, hand-written CSS, Tailwind
   imported but unused, 308 API tests, 28 browser tests, selector inventory recorded before any edit.
2. **Design system and shell.** Tokens, base styles, component library, icon set. Six-group sidebar
   (Home / Work / Services / Organization / Insights / Platform), permission-aware, 248 px or 68 px rail
   with tooltips, drawer under 900 px. 56 px header with breadcrumb, Ctrl+K search, global **Create**
   menu, notifications, help, theme toggle, profile menu. Palette with grouped results, icons, recents
   and page-first ranking.
3. **My Space and notifications.** Live metric tiles, assigned/my tickets with SLA and due, approvals,
   followed tickets, quick requests, recent activity, AI call-out. Bell panel with All / Unread /
   Mentions / Approvals / SLA tabs.
4. **Service Desk.** `#/tickets` list, `#/board` board and `#/desk?view=analytics` share one filter
   bar, chips, saved views (share / unshare / delete), bulk selection and URL state. DataTable with
   column picker and compact rows. Analytics computed from `/api/dashboard` only.
5. **Ticket workspace.** Three columns: context (SLA, requester, followers, attachments) · conversation,
   AI assistance, internal notes, activity · properties and classification. Single **Reopen ticket**
   action in the header.
6. **Catalog and approvals.** Marketplace with search, category chips, grouped tiles; three-step
   request flow; Approval Center with Needs my approval / Requested by me / Completed.
7. **Organisation.** Departments index (hierarchy, cost centres, managers, support demand) and
   department pages; directory links to them; people, knowledge and assets restyled.
8. **Command center.** Overview with six metrics and a **Needs attention** list derived from real
   figures (breaches, unowned urgent tickets, at-risk, unassigned share, overloaded engineer, hottest
   department, low CSAT), each linking to where it is fixed.
9. **Administration.** One layout with Workspace / Platform / Access groups shared by Workspace,
   Settings and Accounts pages.
10. **QA.** Dark palette, responsive pass at 1440 and 390 px (plus the 1366 px collapse asserted by the browser suite), keyboard and landmark review,
    contrast fixes (muted text darkened to 5.5:1 on white, badge inks moved to `-text` tokens, dark
    primary buttons use dark ink, links in running text underlined), axe sweep, builds, audits.

## V2 — second-generation visual pass (complete, screen by screen)

**All screens complete** as of Phase 5. The sections below are the record, phase by phase, of how
each surface was rebuilt; the final verification and the screenshot matrix are under "V2 Phase 5".

**Backend addition (documented before implementation, as the brief requires):**
`GET /api/operations/summary?days=1..30&departmentId=` (support roles). The command center needs
figures no existing endpoint can give without shipping every ticket to the browser: ages of the oldest
unowned and breached tickets, at-risk countdowns (including "under 30 minutes"), per-department and
per-engineer load, ticket flow with a previous-window comparison, mean time to resolve, the
critical-work table and the recent event feed. One server-side definition per figure keeps them
consistent with the ticket page and board (same `evaluateSla`), testable under an injected clock, and
cheap for the client. Covered by `tests/operations-summary.test.ts` (4 tests: authorisation and
window validation; unowned work by priority with ages and department scoping; at-risk → breached
transitions under the injected clock; flow, MTTR, engineer load and the event feed) and by the
permission matrix. No schema change.

**Command Center composition:** executive header with time range, department scope, refresh and
create; one **Service operations pulse** surface with vertical dividers (Active, Unassigned with P1/P2
unowned and oldest age, SLA at risk with under-30-minute count, SLA breached with oldest breach age,
MTTR with previous-window delta, SLA compliance, CSAT with responses and delta); **Global operational
health** (share of active work inside its targets, healthy / at risk / breached strip, owned share,
status mix, oldest unowned, net backlog) beside **Service areas** (ticket categories with an
SLA-derived Healthy / Degraded / Critical state — the workspace has no separate service entity, and the
panel says so); **Needs your attention** feed sorted by severity with an action per item; **Ticket
flow** (created vs resolved, 24H/7D/14D/30D, exact values on hover, created / resolved / net backlog /
resolution rate); **SLA performance** (overall, response, resolution, at risk, breached); **Incident
priority** (P1–P4 bars, restrained colour); **Critical & at-risk work** table (ID, incident, service,
priority, status, owner, SLA countdown, age; rows link to the ticket; at-risk and breached rows get a
3 px edge, never a red row); **Team capacity & demand** (active, at-risk and breached per engineer and
per department — no capacity percentage because capacity targets are not recorded); **Work type**
strip; **Live operations** timeline from stored ticket events with operations language; **Asset
signals**; **Ask OpsPilot** prompts that pre-fill the assistant. Change-window and executive-mode
modules are not shown: change data and role-based views do not exist and were not faked.

**Dashboard state:** `#/dashboard?days=&departmentId=`. Loading shows a skeleton matching the layout;
a failed refresh keeps the last figures visible with a retry.

**Verification for this pass:** `tsc` clean · build clean · API **313/313** (18 files) · browser
**28/28** · screenshots at 1920 × 1080 light and dark, 1440 × 900, 1366 × 768 and full-page 1920 in
`docs/screenshots/v2/`.

### V2 Phase 2 — Service Desk, Board, Ticket Workspace

**Screens completed:** Service Desk (list), Board, Ticket Workspace. My Space and the remaining pages
are untouched in this phase, as instructed.

**Backend additions (all additive, documented, tested):** `GET /api/tickets` gains `sla`
(`at-risk` / `breached` / `healthy`, evaluated from the live SLA position with exact totals for
paging), `assigneeId` and `open=true` (active statuses only). These exist because the work-queue tabs
("At risk", "Breached", "My work", "Unassigned", "Critical") and the SLA and Assignee filters must be
real server filters, and an SLA position is computed, not stored. `slaPosition()` is now the one
shared definition used by the list filter and the operations summary. Covered by new assertions in
`tests/operations-summary.test.ts`. No schema change, no permission-matrix change.

**Service Desk.** Compact operational header with live "active · at risk · unassigned" line; queue
tabs with real counts from the operations summary; one query bar (search with `/` shortcut, Status,
Priority, Type, Assignee, SLA, "+ Filter" for category and label; Saved views with the current view's
name shown, Save view, Columns, Density, More); active-filter chips with Clear all / Save as view;
enterprise table (mono key, summary + metadata line, dot-and-text status and priority, SLA signature
with countdown bar, avatars, relative times; optional Requester / Type / Service / Due / Created
columns; comfortable 54 px and compact 42 px rows remembered per browser); hover and keyboard-focus
row actions (Assign, Status, Add note, more); J / K / Enter / Space / `/` keyboard model; selection
mode turns the toolbar into the bulk bar (existing per-ticket results and partial-failure reporting
preserved); sortable Updated / Created in the URL; table-shaped skeleton, "No tickets match this view"
empty state with actions, and a retryable error state. Every filter, sort and page lives in the URL.

**Board.** Same visual language: compact cards (key, priority mark, title, type · category, SLA,
counts, owner), status-dot column headers, drag lifts the card and dims the original, valid columns
highlight and invalid ones dim, an invalid drop explains itself ("Cannot move directly from Open to
Resolved.") and workflow rules are unchanged.

**Ticket Workspace.** CONTEXT (280 px: editable properties, classification, dates, requester card with
department, manager and a link to their other tickets) · WORKSPACE (header with type, key, title,
service, requester, marks and Assign / Change status / Resolve / more actions; Description with
attachments and secure downloads; Conversation and Activity tabs; enterprise message thread with
hover edit; Internal notes section with lock icon and amber treatment; composer with Reply / Internal
note tabs, Mention, Attach, Knowledge and AI assist actions and Ctrl+Enter) · INTELLIGENCE (340 px:
Service level with first-response and resolution state, Ask OpsPilot with the existing reviewed AI
actions, Suggested knowledge, Related work from the same requester, Followers, Approvals). Resolve
opens a focused dialog that requires a customer-facing summary (sent as a public reply, then the
status change); resolved tickets show a resolution band (time, resolution duration, SLA outcome,
CSAT). Opening a ticket from the desk remembers the queue URL and scroll offset; "Back to queue"
returns to the same filters, sort, page and position. Related-work similarity is not invented: the
panel shows the same requester's tickets and says so.

**Responsive.** 1920 / 1440: three columns; ≤ 1400: intelligence panel becomes a drawer; ≤ 1000:
context panel becomes a drawer; phones get title, marks, conversation and composer.

**Browser-test edits (legitimate UX changes; nothing weakened or deleted):** the note form lives on
the composer's Internal note tab and the audit timeline on the Activity tab, so those tests click the
tab first; the empty-queue heading is now "No tickets match this view"; the board test asserts the
Desk-view switch's `aria-current` instead of a page heading; the phone AI test opens the
intelligence drawer first.

**Verification for this pass:** `tsc` clean · build clean · API **313/313** (18 files) · browser
**28/28** · `npm audit` 0 vulnerabilities · axe-core sweep of desk, at-risk queue, empty queue, board,
ticket, note composer, resolve dialog and command center in light and dark (17 states): **0
violations** · screenshots in `docs/screenshots/v2/` (desk, board and ticket at 1920 light/dark and
1366 light, plus critical, at-risk, empty, bulk, hover, Ask OpsPilot, resolve dialog, note composer,
intelligence drawer and mobile states).


### V2 Phase 3 — My Space, Service Catalog, requests, Approval Center, notifications

Employee experience rebuilt on the Phase 2 surface language. Shell, Command Center, Service Desk,
Board and Ticket Workspace are untouched. No backend changes; every screen reads existing endpoints
(`/search`, `/catalog`, `/articles?q=`, `/tickets?requesterId=`, `/approvals?scope=`, `/notifications`,
`/operations/summary` for staff strips).

- **Employee navigation** (`web/app-shell.tsx`): employees get Home / Requests (Service Catalog, My
  requests, Approvals) / Resources (Knowledge, My assets) / Organization / Help (Ask OpsPilot,
  Notifications). No Service Desk, Board or analytics entries. Staff navigation is unchanged.
- **My Space** (`web/myspace.tsx`, replaces the old `HomePage` in `web/shell.tsx`): time-of-day
  greeting, universal help search (services, knowledge, own requests, people, assets from `/search`
  plus the catalog; Enter searches the catalog, "Ask OpsPilot" hands the query to the AI page), one
  hairline-divided "My work" strip (Assigned / Needs approval / My requests / Unread / SLA attention;
  staff-only cells only for staff), "For you" attention list built from pending approvals and unread
  notifications, staff "My work" tabs (Assigned / Following / Requested), employee "My requests" with
  a plain-words *next step* per request, announcements, quick-request launcher from real catalog
  categories, personal activity grouped by day, Ask OpsPilot chips.
- **Employee language** (`web/employee.ts`): `requestStatus` (Awaiting approval, Waiting for you, In
  progress, Submitted, Completed, Not approved), `nextStep`, and `progressSteps` — derived from
  status, assignee, approvals and `resolvedAt`; the Approval step only appears when the request has one.
  SLA notifications are re-worded for employees as "Running late" and never use the acronym.
- **My requests + request detail** (`web/requests.tsx`, routes `/requests`, `/requests?tab=`,
  `/requests/:id`): tabs In progress / Waiting for me / Completed / All; detail page with progress
  steps, "Next:" line, request details and form answers, attachments, Approval section, rating prompt,
  conversation with composer, Updates timeline, an employee-worded Service level card (expected reply /
  completion from the real SLA record) and "Who is involved". Staff get "Open in Service Desk".
- **Service Catalog marketplace** (`web/catalog.tsx` rewritten): search that also returns knowledge
  articles, Recently used (from the person's own requests), category tiles, service list with WHAT /
  WHY / APPROVAL, service detail (approval route, what you'll need, previous requests), and a
  DETAILS → REVIEW → SUBMITTED flow driven by the URL (`?service=&step=form|review`, `?submitted=`).
  Inline validation (`aria-invalid`, per-field messages, summary alert), persistent request summary
  sidebar, and a success state that shows the real ticket id and what happens next. Free-form
  issues go through `?service=issue` with impact/urgency and the priority matrix explanation. Form
  fields use `label[for]` so the accessible name is the label alone; required marks are CSS.
- **Approval Center** (`web/approvals.tsx`, new): header "Decisions waiting for you", tabs Needs my
  approval / Requested by me / Completed (with Approved / Rejected chips), cards with requester, the
  catalog item, the stated business reason, key and age. Review dialog (requester, request, business
  justification, request details, approval history, note). Approve asks for a confirmation that names
  the request and the requester; Reject requires a reason. Decisions show an inline band and land in
  Completed with the note.
- **Notification inbox** (`web/shell.tsx` `NotificationBell`): 400px panel, tabs All / Mentions /
  Approvals / Requests (+ SLA for staff), Today / Yesterday / Earlier grouping, unread surface and
  dot, plain-words titles ("Decision made", "New reply", "Running late"), links go to the request
  view for employees and the ticket workspace for staff. While open the page behind is `inert` and
  focus stays inside. Notification centre (`web/notify.tsx`) uses the same rows plus preference
  groups (Requests / Mentions / Approvals / Tickets). Channels are shown honestly as "In-app + email":
  the server has one delivery decision per kind, so no per-channel switch is pretended.
- Header Create button gained `aria-label="Create"` (its text is hidden on phones).

Verification (all executed): `tsc --noEmit` clean; `vite build` clean; API `vitest` 313/313 (18 files);
Playwright 28/28 (updated for the new flows: issue creation via the catalog's "Report an IT issue",
confirmation → request view, approval review → confirm, employee mobile nav "My requests");
`npm audit` 0 vulnerabilities; axe-core WCAG 2.2 AA sweeps: employee 23 states (light + dark: My
Space, Catalog, issue flow, service detail, form, validation, My requests, request detail, Approvals,
Notifications, bell panel) 0 violations; admin 15 states 0 violations; flow-state sweep (review,
approve-confirm, reject dialog, decided band, completed, success, 390px pages) 12 states 0 violations.
Screenshots: `docs/screenshots/v2/p3-*.png` (31).


### V2 Phase 4 — backend additions, decided and documented before implementation

Phase 4 (Knowledge, Assets, People, Departments) is mostly a read layer over data the API already
exposes. Four things it needs honestly cannot be served by the current endpoints. Each is additive,
each is permission-checked, each is covered by the permission matrix test.

1. **Article feedback — one new table, two endpoints.** The brief asks for *Helpful / Not helpful*
   on an article and for a helpfulness figure in search results. Nothing in the schema records
   whether an article helped anyone, and inventing a percentage is exactly the kind of fake number
   this project refuses. So: table `ArticleFeedback(id, articleId, userId, helpful, createdAt)` with
   a unique `(articleId, userId)` so one person counts once and can change their mind;
   `POST /api/articles/:id/feedback {helpful}` for anyone who can read the article (the article
   scope decides, so a restricted runbook cannot be voted on by an employee); counts returned with
   `GET /api/articles/:id`. The UI shows "3 of 4 people found this helpful" only when votes exist —
   never a manufactured percentage.
2. **`GET /api/knowledge/overview` — one new read endpoint.** The Knowledge home needs per-category
   article counts, the recently updated set, and the most-helpful set, each filtered by the caller's
   own visibility. Deriving that in the browser means downloading the whole article table, which is
   wrong at any realistic size (brief §51). The endpoint returns aggregates only, computed under the
   same `articleScope` used everywhere else, so a support-only runbook never contributes to a count
   an employee can see.
3. **`GET /api/assets/summary` — one new read endpoint.** The asset strip needs total / assigned /
   unassigned / attention / retired over the caller's *whole* authorised inventory, not over the
   current page. `assetMetrics()` already computes exactly this server-side for the dashboard; this
   exposes it through the same `assetScope` as the list, so the strip can never disagree with the
   rows beneath it.
4. **Additive query parameters and richer payloads — no new routes, no access change.** `/assets`
   gains `ownerId`, `departmentId`, `warranty` and `sort`, and returns each owner's department;
   `/people` gains `managerId` and `role`; `/search` gains departments and catalog services and
   returns enough context (title, department, owner, category) to choose a result. Every one of
   these still runs inside the existing scope helper for its entity.

Not added, deliberately: no asset telemetry, no view counters, no "popular" ranking (nothing records
reads), no per-asset location field (the schema has none — the owner's location is shown, labelled
as the owner's), and no lifecycle event table (the lifecycle strip is derived from recorded dates
and status, and says "Not recorded" where a date is missing). Asset audit history for
administrators reuses the existing `GET /api/admin/audit?q=<asset id>` rather than adding a route.


### V2 Phase 4 — Knowledge, Assets, People, Departments

The resource layer: what the organisation knows, what it owns, who works here and where service
demand comes from. Shell, Command Center, Service Desk, Board, Ticket Workspace, My Space, Service
Catalog, requests, approvals and notifications are unchanged apart from consistency fixes.

**Demo signal, first.** The reported "130+ unread notifications" was not produced by the demo seed:
the seed created no notifications at all, so a freshly seeded demo inbox was empty. The wall of
unread belonged to the browser-test database, which is reused between runs and had accumulated the
notifications of every earlier run. Both halves were wrong to leave, so the seed now writes a
believable inbox — a fortnight of already-read history, and four unread of different kinds (a
mention, an approval request, a reply on a request, a rating request). It also marks anything else
addressed to a demo account as read, which is display state, not delivery. (An announcement is not
a notification kind in this system; announcements are published to My Space.) Runtime notification
behaviour is untouched: these are ordinary `Outbox` rows written as already delivered.

**The demo organisation** (`prisma/demo-story.ts`, new; seed-only): fourteen people in five
departments with managers, titles, locations and cost centres; twenty-eight assets with owners,
warranties and two deliberately needing attention; twenty tickets and catalog requests spread over
three weeks — resolved with ratings, in progress with replies, waiting on the requester, and two
deliberately late; article feedback from named colleagues; and the catalog, templates and
announcements. Maya Chen's laptop, her VPN ticket, her department and her manager's approval queue
are one consistent story. The four documented sign-ins are unchanged; the ten colleagues are
directory-only, created with a random password nobody is given.

- **Knowledge** (`web/knowledge.tsx`, rebuilt): a search-led home with Recommended (derived from the
  reader's own open tickets, and it says so), Most helpful (real votes), category browser with
  counts, and Recently updated — each article appearing once. Results are a clean list carrying
  category, freshness, helpfulness and reading time (computed from the article's own word count).
  The article is a three-column reading view: category navigation, the document, and metadata with
  a scroll-spy contents list for long articles, appearing only above three headings and collapsing
  to a drawer on narrow screens. Helpful / Not helpful writes a real vote; "3 of 4 people found this
  helpful" is a count of rows, never a percentage. "Still need help?" lists only catalog services
  that share the article's category — a derived relationship, not a guess.
- **Assets** (`web/assets.tsx`, new; the old inventory lived inside `web/operations.tsx`): header
  with real counts, one hairline-divided inventory strip (total, assigned, unassigned, attention,
  retired) computed by `/assets/summary` over the caller's whole authorised inventory, a filter bar
  whose state lives in the URL, and a table that reads asset, type, owner, department, status,
  health, warranty and last change. Health is honest: it is a reading of the recorded status,
  warranty date and ownership, and the detail page says which fact produced it. The asset workspace
  answers what it is, who has it, whether it is healthy, what happened to it (real linked tickets,
  scoped so an employee sees only their own) and where it is in its lifecycle — a strip derived from
  recorded dates and status that says "Not recorded" rather than inventing a stage.
- **People** (`web/people.tsx`, rebuilt): a directory list with search, department and manager
  filters; a profile with tabs for Overview, Requests, Assets and Team. Requests and Assets appear
  only where the API already allowed them — an employee sees another employee's identity and place
  in the organisation, and nothing about their work. Assigned hardware links to the asset, the
  department links to the department, the manager and reports link to their profiles.
- **Departments** (`web/departments.tsx`, rebuilt): a directory with manager, headcount, cost centre
  and — for support roles only — open requests and SLA risk. The detail page gives employees the
  organisational facts and support roles a service-demand surface (active, unassigned, at risk,
  breached, SLA) built from `/operations/summary?departmentId=`, the Command Center's own endpoint,
  so the two can never disagree. Work type, 30-day flow and the department's own activity sit
  alongside; the demand block fails on its own and says so without taking the page down.
- **Cross-module navigation**: ticket → requester → department → assigned asset → service history →
  ticket, and knowledge → relevant service, each a real link. The command palette and `/search` now
  cover departments and catalog services and return enough context to identify a result (a person's
  role and team, an asset's model and holder, an article's category), all under the caller's own
  scope.
- Consistency fixes: asset vocabulary in the shared label map ("In use", "In stock", "In repair"),
  avatars no longer stretch in flex rows, the header Create button has an accessible name at phone
  width, and the retrieval index no longer touches an article's `updatedAt` — indexing is
  bookkeeping, not an edit, and letting it bump the date made "Recently updated" meaningless.
- **Live updates no longer blank the page.** `useRecord` cleared its data on every refresh, so each
  server-sent event replaced the current screen with a skeleton and remounted everything under it:
  a visible flicker, lost scroll position, and — on the ticket workspace — a silently discarded
  status change if a colleague replied while an engineer had the properties form open. It now keeps
  what is on screen while refetching the same path, and clears only when the path itself changes
  (the guard that stops one route's payload rendering in another's shape). The ticket properties
  form is likewise re-seeded when the ticket's own properties change rather than on every version
  bump. This was found as an intermittent browser-test failure and fixed at the cause; one test that
  had been relying on the remount to collapse a row's controls now asserts the better behaviour.

Verification (all executed): `tsc --noEmit` clean; `vite build` clean; API `vitest` **327/327**
(19 files, including 11 new cases for feedback scoping, knowledge aggregates, asset summary/filter
agreement and directory filters); Playwright **30/30** (two new: the ticket → person → department →
asset → service-history journey, and an employee being refused department demand by UI *and* by
URL); `npm audit` 0 vulnerabilities; axe-core WCAG 2.2 AA: 23 states as an engineer, 25 as an
employee, 10 mobile and filtered states — 0 violations in all three sweeps. Screenshots:
`docs/screenshots/v2/p4-*.png` (40), captured against a freshly seeded demo database rather than
the reused test database, so they show what a reviewer sees after `start.bat`.


### V2 Phase 5 — backend additions, decided and documented before implementation

Phase 5 turns the finished modules into one product: Service Intelligence, Reports, an
Administration control plane, sign-in, and the global states in between. Two read endpoints are
added, both staff-only, both computed from stored rows under the same SLA evaluation the rest of the
API uses. No schema change.

1. **`GET /api/analytics`** — the Command Center answers *what needs action now* from
   `/operations/summary`; Service Intelligence answers *how are we performing over time*, which
   needs figures that endpoint does not carry: a previous-period comparison for every headline
   metric, per-day series for backlog, SLA outcome, satisfaction and time-to-resolve, demand broken
   down by department, type, priority and category over the window, breaches by department and
   priority with the day each breach happened, an age distribution of open work, satisfaction by
   department with its sample size, and a neutral per-engineer workload table. Computing them in the
   browser would mean downloading every ticket. Filters (`days`, `departmentId`, `type`,
   `priority`) are applied server-side and echoed back. A comparison is reported only when both
   periods have a value; "at-risk trend" is deliberately absent, because at-risk is a live position
   and the system stores no historical snapshots to reconstruct it from.
2. **`GET /api/reports/:kind`** — eight report kinds (`tickets`, `sla`, `resolution`, `csat`,
   `requests`, `departments`, `agents`, `assets`) returning a summary, column definitions and rows
   under the same filters, and the same rows as `text/csv` with `?format=csv`. Export respects the
   filters exactly and runs behind the same `staff` guard as the JSON; nothing is exported that the
   caller could not read row by row. CSV only — no PDF or report-generation machinery.

Not added, deliberately: no per-agent ranking or scoring, no "top performer" ordering (rows are
alphabetical), no historical at-risk series, no SSO/SCIM/session-policy settings pages (none of
those capabilities exist; they belong in the roadmap, not in a settings screen), and no workflow
editor beyond what the fixed transition table supports.

### V2 Phase 5 — Service Intelligence, Reports, Administration, sign-in and final product QA

**Service Intelligence** (`#/analytics`, `web/analytics.tsx`, staff only). Header "SERVICE
INTELLIGENCE / Operational performance"; period (7D–1Y), department, type and priority live in the
URL. An executive strip of six figures — SLA compliance, time to resolve, satisfaction, resolution
rate, backlog, first response — each with its denominator and an honest comparison: a delta is shown
only when both periods have a value, otherwise "no previous period to compare". A trend chart with a
metric switch (ticket volume, resolution, SLA, CSAT, backlog) that leaves gaps where a day has no
measurement instead of drawing zero. Demand by department (stacked by type), category, service and
a department × priority heat table. SLA analysis with breaches by priority and department and the
recent breaches themselves. Resolution performance with an age distribution of open work and the
oldest unresolved tickets. Employee experience with a five-star distribution and "limited" marked
on any sample under five. Team workload is alphabetical and says so — there is no ranking anywhere.
Every figure links to the Service Desk or a report with the same filters.

**Reports** (`#/reports`, `web/reports.tsx`). A library grouped into service operations, employee
experience, organisation and assets; each report opens a workspace with title, description, the
same four filters, a summary strip, a table and **Export CSV**, which downloads exactly the filtered
rows through the same staff guard. No PDF.

**Administration** is one control plane (`web/admin-nav.tsx`, `web/admin-pages.tsx`, `web/admin.tsx`,
`web/users.tsx`, `web/workspace-admin.tsx`): a secondary navigation grouped ORGANIZATION / SERVICE
MANAGEMENT / ACCESS / EXPERIENCE / INTELLIGENCE / PLATFORM beside a settings workspace, every page
built from titled sections with an explanation and its controls. **Accounts & access** is system
access (role, access state, second factor, last sign-in, a Manage menu of the administrator
actions the API has) and points to People for organisational identity. **Roles & permissions**
shows what each role may do as the API enforces it. **Workflow** shows the types, the transition
table with what each transition does to the SLA clock, and the impact × urgency matrix, and says it
is read-only in this release. **Security** lists the protections actually in force (session
lifetime, lockout, rate limit, second-factor policy, password floor, origin and CSRF) read from the
server, and names SSO/SCIM/IP allow-lists as not in this release rather than drawing switches for
them. **Audit log** groups actions, keeps the raw action code visible, and exports CSV. The old
`#/settings/*` and `#/users` paths still resolve.

**Sign-in** (`web/main.tsx`): a split page — brand, "Keep services moving.", three audience
points and an abstract product preview with no numbers on the left; "WELCOME BACK / Sign in to your
OpsPilot workspace." on the right. No SSO buttons and no self-registration, because neither exists;
the footer says accounts are provisioned by an administrator. On phones the story collapses to the
brand and headline above the form.

**Global states.** A 403 page ("You don’t have access to this area.") for employee visits to staff
areas and a 404 page with a way home; the footer shows "Live updates reconnecting…" while the SSE
connection is down and a toast says "Live updates restored." when it returns, after which the page
refetches once. `useLive` now reports `connecting | live | reconnecting`.

**Product-wide.** Command palette actions cover the whole product (report an issue, request a
service, ask OpsPilot, knowledge, my requests, Service Desk, Command Center, Service Intelligence,
Reports, and the administration areas for administrators). Search puts an exact ticket key first
however it is typed (`OPS-0012`, `ops 12`, `12`). Staff and administration routes are lazy-loaded:
the main bundle fell from 714 kB to 580 kB (160.55 kB gzip) with no change in behaviour.

**Design system.** Segmented control (`.seg`), KPI strip (`.si-strip`/`.kpi`), fact list
(`.si-facts`, a real `<dl>`), ranked bars, heat table, settings section, control-plane layout,
state page and sign-in blocks were added; 113 dead legacy rules were removed after confirming by
search that no markup used them (`web/style.css` 197,116 → 186,139 bytes before the final fixes).

**Final QA on the finished code** (all executed, results below): a 51-screenshot matrix from a
freshly seeded demo database (`docs/screenshots/v2/p5-*.png`) at 1920 light and dark, 1366 light,
390 and 360, actually inspected; findings fixed — page-level horizontal overflow on five mobile
routes (analytics, Command Center controls, catalog list, workflow matrix, account filters),
the report table clipped at 1920 (report workspace widened to 1760 px), the breadcrumb truncated at
1366 (header search narrowed below 1500 px), overview area links underlined, the "you" marker
wrapping in Accounts, mixed spacing in the Manage menu, unreadable chart ticks at 1366, and the
sign-in story hidden on phones. A probe of 29 routes at 390 and 360 reports `scrollWidth ==
viewport` on every one. At 2560 content is bounded at 2,136 px (analytics, desk, Command Center,
administration) or the narrower reading widths (My Space 1,320, reports 1,760). **SSE audit:** a
public reply posted from a second browser session while the first was typing a reply on another
ticket left the draft, the URL and the selected tab untouched. **axe-core** (`wcag2a/aa`,
`wcag21a/aa`, `wcag22aa`): 26 page states across sign-in (light, dark, 390), My Space 390, catalog
360, analytics (light, dark, 390, 7-day), reports (library, SLA, CSAT dark, tickets), the
administration overview, accounts (list, menu, dark), workflow, roles, service levels, catalog admin,
audit, security, data, admin 390, 404, 403 and the palette — three findings during the sweep
(`dt/dd` outside a `dl`, empty heat cells as unnamed links, a 24 px target) fixed and re-swept to
**0 violations**.

## Known limitations

- Column visibility, density, theme and the collapsed sidebar are remembered per browser
  (`localStorage`), not per account.
- Service Intelligence has no historical at-risk series: at-risk is a live SLA position and no
  snapshots are stored, so the trend chart offers volume, resolution, SLA outcome, CSAT and backlog
  only. Comparisons need both periods to have data, so a fresh workspace shows "no previous period
  to compare" for a while — that is the honest state, not a bug.
- Reports export CSV only; there is no PDF, scheduling or e-mailed report.
- Workflow, roles and permissions are shown as the API enforces them and cannot be edited in the
  interface; there is no workflow designer.
- The Security page reports protections read from the server configuration; changing one means
  changing the environment. SSO/SAML, SCIM provisioning, IP allow-lists and per-role session
  policies are not implemented and are not shown as settings.
- Saved views are shared as "shared with the workspace"; there is no per-team sharing.
- Google Fonts are optional: without network the system font stack is used.
- Not implemented and not faked: SSO/SCIM, CMDB relationships, attachment previews, multi-stage
  approval chains, custom workflows, scheduled reports, business-hours SLA calendars. The interface
  never shows a control for a capability the backend does not have.

## Suggested next features

Recommendations only; none is started.

1. SSO (SAML/OIDC) and SCIM provisioning, replacing the "Not in this release" note on Security.
2. Approval chains (ordered approvers) and per-department routing on catalog items.
3. Business-hours SLA calendars per department, with the calendar snapshotted per ticket as the
   targets already are.
4. Per-account UI preferences (a small `preferences` JSON column) so column sets follow the person.
5. Team-scoped saved views and queues.
6. Inline attachment previews for images and PDFs, served with the same download-only safeguards.
7. Scheduled, e-mailed report exports built on the existing outbox.
8. CMDB-style asset relationships (asset ↔ service ↔ department) feeding impact on the Command Center.
