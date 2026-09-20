# The workspace

What was added when OpsPilot grew from a ticket tracker into a service desk, how each piece behaves,
and where the edges are. Nothing here changes the rules the earlier phases established: employees
see their own records, support staff see the workspace, every mutation is server-checked, and
nothing is sent or changed by AI without a person.

## Ticket types and the priority matrix

Every ticket has a **type** — Incident, Service request, Problem or Change — and an **impact** and
**urgency** (Low / Medium / High). The matrix turns the pair into a starting priority:

| | Urgency Low | Urgency Medium | Urgency High |
| --- | --- | --- | --- |
| **Impact Low** | Low | Low | Medium |
| **Impact Medium** | Low | Medium | High |
| **Impact High** | Medium | High | Urgent |

Employees answer two plain questions ("how many people are affected?", "how quickly do you need
this?") and see the resulting priority before they submit. Staff can override the priority, and
changing impact or urgency later re-derives it unless a priority is named in the same save.

Tickets also carry up to ten **labels** (lowercase, letters/digits/space/`- _ . /`), an optional
**due date**, and a **board rank**.

## The board

`/board` shows the active columns — Open, In Progress, Waiting for User, Resolved, and Closed on
request — with cards in rank order. Support staff drag cards between columns; the server applies
the same transition rules as the ticket page (`transitions` in `shared/model.ts`), so a card
dropped where the workflow does not allow it stays where it was and the column shows a red edge
while hovering. Reordering within a column uses gapped integer ranks; when two neighbours have no
gap left the column is renumbered in the same transaction.

Quick filters (search, type, priority, assignment, label, closed) live in the URL, so a board state
is a link. **Saved views** store those filters by name, privately by default; support staff can
share a view with everyone. **Select** turns on checkboxes and a bulk bar: status, priority,
assignee and labels for up to 100 tickets at once, applied per ticket in its own transaction, with
a per-ticket reason for anything skipped (a disallowed transition, for instance) and one audit
event for the batch.

Employees see the board too, scoped to their own tickets, read-only.

The board reads the first 500 tickets in the selected scope (by rank, then creation) and has no
pagination; a queue larger than that is worked from the Service Desk list, which is paginated.

## Service catalog

Administrators publish **catalog items** under *Workspace → Service catalog*: a name, description,
icon, ticket type, category, default priority, and a **form** of up to twenty fields (text,
textarea, select, number, date, checkbox; required or not; with options, placeholder and help text).
Field keys must be unique and a select must have options — both enforced by the schema.

On *New ticket* the catalog appears as tiles above the classic "report an issue" form. Choosing one
renders its form; the answers are validated server-side against the item's schema (unknown keys are
refused) and stored on the ticket as `formData`, shown on the ticket page and on the approval
card. The ticket inherits the item's type and priority. **Templates** (*Workspace → Templates*)
prefill the classic form instead: title, description prompts, category, type, priority.

While someone types a description, **suggested articles** appear from the knowledge base — the same
permission-filtered search the knowledge page uses, so an employee is never shown a support-only
runbook.

## Approvals

A catalog item can require approval, by the requester's **manager**, an **administrator**, or a
named **department's manager**. The approver is resolved when the request is submitted; if the
chain is empty (no manager on file) it falls back to an administrator rather than stalling, and
the event log says so. The approver — who may be an employee — can open that one ticket, sees it on
*Approvals* and on their home page, is notified, and approves or rejects with an optional note.
A rejection resolves the request. Decisions are single-use, audited, and visible on the ticket's
Approval panel and activity stream. Administrators may decide any pending approval.

## Collaboration

- **Followers.** The requester follows their ticket automatically; an assignee is added when
  assigned. Anyone who can read a ticket can follow it; support staff can add a colleague, but only
  one who can already read it — following never grants access. Followers are notified of status
  changes, replies and attachments they did not cause, unless they are already the requester or
  assignee (who hear about it anyway).
- **@mentions.** Typing `@` in a reply offers people who can read the ticket; `@Full Name` is
  matched longest-name-first so "@Maya Chen" is never mistaken for another Maya. Mentioned people
  are notified and highlighted in the reply. Mentioning someone who cannot read the ticket does
  nothing, quietly.
- **Attachments.** Images, PDF, text/CSV/log, docx, xlsx and zip, up to `ATTACHMENT_MAX_MB`
  (default 10). The extension, the declared content type and the file's leading bytes must all
  agree, so a renamed executable or an HTML file called `.png` is refused. Files are stored under
  `UPLOAD_DIR` with random names, never inside the web root, hashed on upload, and **always served
  as downloads** with `nosniff` and a sandboxing CSP — nothing uploaded can run in the browser.
  The uploader or an administrator can remove a file.
- **Editing a reply.** Authors can edit their own public replies for fifteen minutes (support
  staff, indefinitely); the reply shows "edited" and the edit is in the audit log. Internal notes
  are unchanged: append-only, staff-only.
- **Activity stream.** One timeline of events, replies, notes, attachments and approval decisions,
  with internal entries removed for employees.

## Satisfaction

When a ticket is resolved the requester is asked, on the ticket and in their inbox, to rate it one
to five stars with an optional comment — once, only by the requester, only after resolution.
Ratings feed the reports.

## People and organisation

**Departments** (*Workspace → Departments*) have a name, a short code, a cost centre, a manager and
an optional parent. Administrators place people in departments and set their manager; people edit
their own title, location and phone. The **directory** (`/people`) is searchable and filterable by
department; a **profile** shows contact details, manager, direct reports, and — for support staff
or the person themselves — open tickets and assigned hardware. The ticket page shows a **requester
card** with department, manager and contact details to staff.

**Announcements** (*Workspace → Announcements*) appear on everyone's home page (or the support
team's only), pinned or not, with an optional expiry. Publishing pushes a live update.

## Home, palette, notifications, live updates

- **Home** is "My space": live counts (open tickets, approvals needed, unread, and for staff the
  unassigned queue), announcements, the person's own tickets (or, for staff, their assignments) with
  SLA and due dates, approvals waiting for them, tickets they follow, quick tiles for the catalog and
  recent activity. The operations dashboard is *Overview* for support staff.
- The **Service Desk** is one page with three views that share filters, chips, saved views and bulk
  selection, all in the URL: `#/tickets` (list), `#/board` (board) and `#/desk?view=analytics`.
- The **Approval Center** (`#/approvals`) has three tabs: *Needs my approval*, *Requested by me*
  (`GET /api/approvals?scope=requester`) and *Completed*.
- **Departments** (`#/departments`, `#/departments/:id`) show the hierarchy, cost centres, managers,
  members and — for staff — the support demand each department generates. Editing stays under
  *Administration → Departments*.
- The visual language is documented in [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md); the redesign itself in
  [REDESIGN-CHANGELOG.md](REDESIGN-CHANGELOG.md).
- **Ctrl+K** opens the command palette: every page by name, plus tickets, people, articles and
  assets from `/search`, which applies the caller's permissions. Arrow keys and Enter.
- The **bell** shows the unread count and the latest notifications with All / Unread / Mentions / Approvals / SLA tabs; the **notification
  centre** lists everything with read state and per-kind **preferences** (assignments, replies,
  mentions, followed tickets, SLA, approval decisions, rating requests). Approval *requests*
  addressed to a person are always delivered. The browser tab title carries the unread count.
- **Live updates** arrive over server-sent events (`/api/events/stream`). Each event is only a hint
  — "something about your tickets changed" — and the page refetches through the ordinary,
  authorised endpoints. One process, one bus; with several replicas each tab hears its own process.

## Service Intelligence and reports

`#/analytics` (support staff) is computed by `GET /api/analytics` from stored rows under the same
SLA evaluation as everything else: headline figures with denominators and a comparison only when
both periods have data; per-day series; demand by department, type, priority, category and
service; breaches by department and priority; the age distribution of open work; satisfaction with
sample sizes; and an alphabetical team table. Period, department, type and priority are URL state.

`#/reports` (support staff) lists eight reports — tickets, SLA, resolution, satisfaction, requests,
departments, agents, assets — each a filterable table with a summary strip and **Export CSV**
(`GET /api/reports/:kind?format=csv`), which contains exactly the rows on screen. Nothing is sampled
or estimated, and nothing is exported that the caller could not read row by row.

## Administration

One control plane at `#/admin` with a grouped secondary navigation: Organization (overview,
departments), Service management (catalog, templates, workflow, service levels), Access (accounts
and access, roles and permissions), Experience (announcements, notification outbox), Intelligence
(AI and retrieval) and Platform (audit log, security, data and retention). Accounts are system
access; People is organisational identity. Workflow and roles are shown as enforced and are not
editable. Security reports the protections in force from configuration and names what is not in
this release. Every administrative action is written to the audit log.

## What is deliberately not here

Multi-level approval chains; SLA calendars per department; attachment previews (files always
download); real-time collaborative editing; mobile push; a full org chart visualisation;
per-department ticket routing; a workflow editor; SSO/SCIM; scheduled or PDF reports; a historical
at-risk trend (at-risk is a live position and no snapshots are stored). Each is a reasonable next
step and none is half-built.
