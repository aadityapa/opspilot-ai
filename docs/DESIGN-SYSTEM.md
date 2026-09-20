# OpsPilot design system

Everything the interface is built from lives in three files. Pages never invent a colour, a size or a
duration; they read tokens and compose components.

| File | What it holds |
| --- | --- |
| `web/ui/tokens.css` | Design tokens: colour (light and dark palettes), typography scale, spacing, radius, elevation, motion, z-index layers, layout constants, semantic states. |
| `web/ui/base.css` | Reset, buttons, inputs, layout primitives, panels, badges, SLA indicators, avatars, metrics, tables, filter bar, tabs, pagination, empty/loading/error states, alerts, toasts, menus, modal and drawer, activity timeline, breadcrumbs, property lists, tooltips. |
| `web/ui/index.tsx` + `web/ui/icons.tsx` | React components (below) and the stroke icon set (`Icon`, `Logo`). |

`web/style.css` imports both stylesheets and adds the application shell, the sign-in screen and
page-specific classes. Every class name that existed before the redesign still works, restyled on
tokens, so older modules render correctly without edits.

## Tokens

**Colour.** `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--border`, `--border-strong`,
`--text`, `--text-2`, `--text-3`, `--accent` (+ `-strong`, `-soft`, `-text`), `--cyan` (the AI
colour), semantic `--success/--warning/--danger/--info/--neutral` each with `-soft` (background) and
`-text` (AA-safe ink on the soft background), priority `--p1…--p4` (+ `-soft`, `-text`), ticket status
`--st-open/--st-progress/--st-waiting/--st-resolved/--st-closed` (+ `-soft`, `-text`), and the always-
dark navigation palette `--nav-*`. Priority and status are never colour-only: every badge carries a
text label and a leading dot.

**Dark mode** is a second, deliberately chosen palette under `[data-theme='dark']`, not an inversion:
surfaces get lighter as they rise, accents are lifted for contrast, and primary buttons switch to dark
ink on the lifted accent. The choice is stored in `localStorage` (`theme`) and applied to `<html>`.

**Typography** (Inter, JetBrains Mono for keys and code, system fallbacks):

| Class | Size / line | Use |
| --- | --- | --- |
| `.t-display` | 32 / 40 | Sign-in hero, greeting |
| `.t-h1` / `h1` | 28 / 34 (30 on the command center) | Page titles |
| `.t-h2` / `h2` | 16 / 22 | Panel titles |
| `.t-h3` / `h3` | 14 / 20 | Sub-sections |
| body | 14 / 20 | Default |
| `.t-sm` | 13 / 18 | Dense UI, table cells |
| `.t-label` / `.eyebrow` | 11 / 16, uppercase, tracked | Section labels |
| `.t-number` | 28 / 32, tabular | Operational numbers |
| `.t-caption` / `.fine` | 12 / 16 | Hints |
| `.t-mono` / `code` | 12.5 | Ticket keys, asset tags |

**Spacing** is a 4 px scale: `--s1` 4, `--s2` 8, `--s3` 12, `--s4` 16, `--s5` 20, `--s6` 24, `--s8` 32,
`--s10` 40, `--s12` 48, `--s16` 64. **Radius:** `--r-sm` 6, `--r-md` 8, `--r-lg` 12, `--r-xl` 16,
`--r-pill`. **Elevation:** `--shadow-sm/md/lg`, `--ring` (focus). **Motion:** `--t-fast` 150 ms and
`--t-med` 220 ms with one easing curve; `prefers-reduced-motion` collapses both. **Layers:** sticky 20,
dropdown 40, drawer 60, modal 80, toast 100, palette 120. **Layout:** sidebar 240 px (68 px collapsed),
header 56 px, content max 2200 px so 1920 and 2560 displays are used.

## Components (`web/ui/index.tsx`)

`PageHeader`, `Crumbs`, `Tabs`, `MetricCard`, `PriorityBadge` (P1–P4 with label), `StatusBadge`,
`TypeBadge`, `SlaIndicator` (healthy / warning / risk / breach / paused / done, optional budget bar),
`Avatar`, `AvatarGroup`, `PersonChip`, `FilterChip`, `Menu`, `Modal`, `Drawer`, `ConfirmDialog`,
`toast()` + `ToastHost`, `DataTable` (column config, hidden columns, dense rows, selection, row links,
sort affordance), `Pager`, `EmptyState`, `Skeleton`, `ErrorState`, `Loaded`, `Kbd`, `usePref`
(per-browser preferences under the `opspilot:` prefix). Helpers: `ticketKey`, `fmtDate`, `fmtDay`,
`fmtAgo`, `fmtDuration`, `initials`, `slaState`.

Charts live in `web/ui/charts.tsx` (`AreaChart`, `SegmentBar`, `RankBars`, `Ring`, `Sparkline`): dependency-free SVG, tokens for colour, exact values on hover, never smoothed or extrapolated.

Shell pieces live in `web/app-shell.tsx` (`buildNav`, `Sidebar`, `Header`, `CreateMenu`, `routeCrumbs`,
`useMedia`) and `web/shell.tsx` (`CommandPalette`, `NotificationBell`, `ProfileMenu`, `HomePage`).
Administration pages share `web/admin-nav.tsx` (`AdminLayout`).

## Patterns

- **Surfaces, not cards.** Related figures share one surface with hairline dividers (the operations pulse, the health strip, the stat rows); a bordered card is reserved for an independent object. Light mode groups with background contrast and no shadows; dark mode uses four depth layers instead of outlines.
- **Cards are for summaries, not layout.** Lists and tables carry the work; panels group related
  content with a head, body and optional foot. Metric tiles appear only where a number needs a home.
- **URL is state.** Service Desk filters, sort, page and view (`#/tickets`, `#/board`), Service
  Intelligence and report filters (`#/analytics?days=30&departmentId=…`), Approval Center tabs and
  directory department filters are all links.
- **Honest figures.** Every number carries its denominator (`9 resolved`, `mean of 14`); a
  comparison is drawn only when both periods have a value, otherwise the strip says "no previous
  period to compare"; samples under five are marked *limited*; tables of people are alphabetical and
  say they are not a ranking.
- **Settings pages are sections.** Administration pages are a stack of `SettingsSection`s, each with
  a title, one explanatory sentence and its controls; a capability the API does not have is named in
  a "Not in this release" note rather than drawn as a disabled switch.
- **Loading, empty, error.** Every data region renders `Skeleton` while loading, `EmptyState` with a
  next action when there is nothing, and `ErrorState` with the server's message when a call fails.
- **AI is labelled.** Anything produced by a model sits in an `.ai-panel` with the AI mark and a
  provider badge, and never changes data without an explicit user action.
- **Frontend visibility is not authorisation.** Navigation and buttons follow the role the server
  reported for convenience only; every route and API call is checked again on the server.

## Accessibility

Keyboard: skip link, focus ring on every interactive element, Escape closes menus, dialogs and the
palette, arrow keys move through palette results, Ctrl/⌘+K opens search. Landmarks: `banner`,
`navigation` (named), `main`, `search`. Names: every icon-only control has an `aria-label`, collapsed
sidebar links keep their names and show tooltips. Contrast: every text/background pair in both themes
meets WCAG 2.2 AA; links inside running text are underlined; interactive targets are at least 24 px.
`prefers-reduced-motion: reduce` removes transitions and animations globally. axe-core sweeps of
every phase's pages in light, dark and at phone width report zero violations for the `wcag2a/aa`,
`wcag21a/aa` and `wcag22aa` rule sets — the Phase 5 sweep covers 26 page states; see
`docs/REDESIGN-CHANGELOG.md` for how each was run.

## Responsive

Content is bounded at 2,200 px on wide screens (reading surfaces such as My Space at 1,320 px and
reports at 1,760 px). Breakpoints at 1500 px (header search narrows so breadcrumbs keep their last
segment), 1280 px (ticket workspace drops to two columns), 1100 px (header search collapses to an
icon, administration nav moves above the workspace), 1000 px (analytics grid to one column), 900 px
(sidebar becomes an off-canvas drawer, grids stack, sign-in story collapses to brand and headline),
720 px (KPI strip to two columns, segmented controls fill the width) and 600 px (tighter gutters).
Tables, the heat table and the trend chart scroll inside their surface; the page itself never
scrolls horizontally — verified by a probe of 29 routes at 390 and 360 px.
