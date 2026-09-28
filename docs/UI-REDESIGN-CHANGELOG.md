# UI redesign changelog — matte material refinement

Second pass of the visual redesign, driven by the September 2026 UI audit (`OpsPilot-UI-Audit-and-Claude-Prompt.md`)
and its eight reference boards. The first pass (tokens, shell, gradients, orbital mark) is described in
`docs/DESIGN-SYSTEM.md`; this pass replaces the glow-heavy surfaces with matte material, reserves gloss
for primary controls, adds the illustrations and recomposes the pages the audit marked as substantial gaps.

Nothing changed in the API, the data model, permissions or routes except where listed under "Behaviour".
All data on every screen remains real (seeded demo data during verification).

## Material and tokens

- `web/ui/tokens.css`: dark palette re-tuned to the audit's suggested values — page `#080c16`, sidebar
  `#0b1020`, panel `#111827`, raised `#172033` / `#1c2740` / `#202b44`, borders `#29344b` / `#3a4763`,
  text `#f2f5ff` / `#a7b3cc` / `#8795b1`, indigo `#5965ff` (text form `#9aa3ff`), violet `#7756f6`,
  cyan `#63d9f1`. Status and priority pairs were re-measured for 4.5:1 on their tinted pills. New tokens:
  `--accent-gradient`, `--sheen`, `--accent-glow`, `--shadow-card` (matte: inset top highlight plus a
  short drop), `--edge-light` (thin illuminated edge for selection), `--lift`, `--t-fast` 150 ms,
  `--t-med` 220 ms, `--form-max` 720 px, `--reading-max` 74ch. Light theme keeps its own values.
- `web/ui/base.css`: cards are matte (no outer glow); primary buttons carry the gradient, the sheen and a
  1 px lift on hover; secondary buttons stay flat and only lift; tabs and segmented controls use the sheen
  on the active item; avatars are hue-tinted from the name (`--avatar-h`); dialogs and drawers rise or
  slide in 220 ms; `.gloss-tile` (eight hues) and `.is-selected` (edge light) are the two material
  accents allowed outside primary controls. `prefers-reduced-motion` removes every animation, transition
  and hover transform.
- `web/style.css`: shell glows and text shadows removed; sidebar active item gets the illuminated edge;
  a new "V4 · Matte material and page compositions" layer holds the page recompositions listed below and
  the responsive rules (single-column grids use `minmax(0, 1fr)`, tables scroll inside their containers,
  facts strips wrap ≤ 700 px).

## Illustrations and assets

- `web/ui/art.tsx` (new): `DeviceArt` (eight generic device silhouettes), `KnowledgeArt` (laptop, shield,
  network), `OrbitArt` (sign-in orbit with specular and rim gradients, drifting dash rings, pause on
  hidden tab), `ReportGlyph`. All original SVG, theme-aware through tokens.
- `web/assets/mountain-night-hero.jpg` (new): the supplied Unsplash illustration cropped, hue-shifted
  to the indigo range and darkened; used only behind the My Space hero (`.emp-hero`) under a mask so
  text sits on an opaque region. See `docs/ASSET-SOURCES.md`.
- `web/ui/icons.tsx`: `monitor`, `folder-lock`, `orbit` glyphs traced from Lucide (ISC), licence copied
  to `web/assets/lucide/LICENSE.txt`.

## Page compositions

| Area | Files | Change |
| --- | --- | --- |
| Sign in | `web/main.tsx`, `web/style.css` | Orbit illustration replaced by `OrbitArt`; ambient motion is the only continuous animation in the product and pauses when the tab is hidden. |
| My Space | `web/myspace.tsx`, `web/style.css` | Hero backdrop illustration, personal counters as chips, active requests promoted above "For you"; launcher tiles use `GlossIcon`. |
| Service catalog / request flow | `web/catalog.tsx`, `web/style.css` | `GlossIcon` + `tileHue` give every category and service a material tile; grids retuned; request stepper, review and submitted states polished. |
| Command Center | `web/overview.tsx`, `web/style.css` | New `KpiRow` (four primary measures with sparklines), `FactsStrip` (secondary measures in one row), `TeamCapacity`, `DepartmentDemand`; the urgent queue is full width; Pulse / Global health / Team load cards removed in favour of the strip; skeleton mirrors the layout. |
| Ticket workspace | `web/ticket.tsx`, `web/style.css` | Conversation-first thread with the original request as the first message (facts and attachments inline); Conversation · Activity · Approvals · Related tabs; single "Ticket details" aside (SLA, compact properties with a "More" disclosure, AI, suggested knowledge, requester, followers) that becomes a drawer ≤ 1200 px, closes on Escape. |
| Reports | `web/reports.tsx`, `web/style.css` | `ReportLibrary` with search and group tabs; `ReportCard` renders a real preview from the report's own rows; unknown kinds render a designed not-found state. |
| My requests | `web/requests.tsx`, `web/style.css` | Split list / preview (`?sel=`) with progress, next step, updates and the real open route. |
| Approvals | `web/approvals.tsx`, `web/style.css` | Queue beside a reviewer pane (`region "Review request"`) on wide screens; the same body is a dialog ≤ 1100 px; approve / reject keep their confirmation dialogs. |
| Knowledge | `web/knowledge.tsx`, `web/style.css` | Featured card with `KnowledgeArt`; category tiles glossy; numbered steps in articles; non-admin `/knowledge/new` is a designed 403. |
| Assets | `web/assets.tsx`, `web/style.css` | `DeviceArt` thumbnails in the table, hero art on the detail, `WarrantyCard` with days remaining and elapsed share when both dates exist. |
| Ask OpsPilot | `web/ai.tsx`, `web/style.css` | Session thread (question → answer → sources), starters, sticky composer, "this session is not stored" note, Mock AI label and usage. Knowledge-only scope unchanged. |
| Notifications | `web/notify.tsx`, `web/style.css` | Selected-message pane with the primary link (Open ticket / View request / Review approval) and "Mark as read"; selecting marks as read. |
| Account | `web/account.tsx`, `web/main.tsx`, `web/style.css` | Profile card; App preferences with the real theme control (kept in this browser) and a link to notification settings; password form bounded. |
| People / departments | `web/people.tsx`, `web/style.css` | Hue avatars, profile tabs, Assets tab verified. |
| Service Intelligence | `web/analytics.tsx`, `web/style.css` | Section jump navigation, section ids, balanced chart heights. |
| Administration | `web/admin-pages.tsx`, `web/admin.tsx`, `web/workspace-admin.tsx`, `web/users.tsx`, `web/style.css` | Overview fact cards and recent audit activity; accounts creation drawer with designed validation; SLA edit pane for the selected priority; audit inspector for the selected event; announcements live preview; read-only lifecycle flow on the workflow page; catalog editor bounded; permission matrix centred and zebra-striped. |
| State screens | `web/ui/index.tsx` (`StatePage`), `web/main.tsx`, `web/knowledge.tsx`, `web/reports.tsx` | One shape for 403 / 404 / report-not-found with a mark, code, title, explanation and way out. |

## Behaviour

- `useDismiss` (in `web/ui/index.tsx`) closes any popover on outside click, Escape or hash navigation with
  a listener that survives re-renders. Applied to the account menu, create menu, notification bell and
  every `Menu`. This fixes the audit's "menu open over other pages" defect.
- Unknown report kinds (`/reports/anything`) render a not-found state instead of silently showing the
  library.
- Account creation moved from an inline form to a drawer with client validation; the API contract is
  unchanged and invalid input is never posted.
- Escape closes the ticket details drawer and the approvals review dialog.

## Tests

- New `tests/e2e/refinement.spec.ts`: popover dismissal (Escape, outside click, navigation), unknown
  report kind dead end and the `departments` / `agents` kinds, engineer `/knowledge/new` 403, account
  drawer validation with zero POSTs, person Assets tab.
- Updated `operations.spec.ts`, `workflow.spec.ts`, `security.spec.ts`, `ai.spec.ts`, `workspace.spec.ts`
  for the new compositions (KPI region, facts strip, "Urgent attention", SLA edit pane, "Ticket details",
  "Add account" drawer, review region-or-dialog).
- `playwright.config.ts`: `firefox` project added; all browser verification for this pass ran with
  `--project=firefox` (no Chrome or Chromium).

## Not changed on purpose

No SSO providers, no "request changes" approval outcome, no report builder, no business-hours SLA
calendars, no editable workflow transitions, no photo avatars, no stored Ask history, no invented
fulfilment times, targets or metrics. Each is recorded against its board in `docs/UI-REFERENCE-MAPPING.md`.
