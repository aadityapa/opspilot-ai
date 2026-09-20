# OpsPilot V2 — demo script (12–15 minutes)

One story, four fictional people, every number on screen computed from what the demo just did.
Before the audience arrives: `npm.cmd run demo:reset` (see the last section), open
`http://localhost:5173` in two browser profiles (or one normal + one private window), and have the
`DEMO_PASSWORD` from `.env` to hand. AI runs in **mock** mode and says so on screen — mention it
once, early: no key, no network, the same answer every time, and it cannot fail on stage.

**Personas**

| Persona | Account | Role in the story |
| --- | --- | --- |
| Maya Chen | `employee@opspilot.example` | Engineering; needs VPN help, then a new laptop |
| Jordan Patel | `admin@opspilot.example` | Administrator and Maya's manager — approves her request; owns Administration |
| Alex Morgan | `engineer@opspilot.example` | IT Engineer; works the queue |
| Noah Williams | `employee2@opspilot.example` | Sales; has a pending request that shows up in the Command Center — no need to sign in as him |

Expected data after a reset: 20 tickets and requests (3 breached, 1 at risk, 9 resolved), 14
people in 5 departments, 28 assets (Maya owns LAP-0001 and DSK-0001), 11 articles, 5 ratings, one
pending approval (Noah's laptop, waiting for Jordan), 4 unread notifications for Maya.

| # | Click | Say | Value |
| --- | --- | --- | --- |
| **Employee — Maya (window 1)** | | | |
| 1 | Sign in as Maya. | "No SSO button, no 'create an account' — neither exists, so neither is drawn." | Honest surface |
| 2 | **My Space** loads. Point at the greeting, the open work, "Needs your attention", the announcement. | "Everything here is hers, and every number is a link." | Employee home |
| 3 | Press **Ctrl+K**, type `vpn`, press Enter on *Reconnect to the company VPN*. | "Search first. The palette reaches articles, tickets, people, assets and actions." | Find |
| 4 | Scroll the article: table of contents, reading time, **Helpful**. Click *Helpful*. | "Feedback is a stored vote, one per person, changeable." | Knowledge |
| 5 | Bottom of the article: **Still need help?** → *Report an issue*. | "The article hands off to the right service instead of a dead end." | Find → Request |
| 6 | Title *VPN still dropping on video calls*, category Network, description two sentences, link asset **LAP-0001**, submit. | "Priority came from the impact × urgency matrix, not a guess. The SLA clock started now." | Request |
| 7 | Sidebar **My requests** → open it. Show status, the SLA panel, the linked laptop. | "She can see exactly where it is and what the target is." | Track |
| 8 | **Service Catalog** → *New laptop* → fill the form → submit. | "This one needs approval; the catalog item says who approves before she fills anything in." | Request with approval |
| **Manager — Jordan (window 2)** | | | |
| 9 | Sign in as Jordan. Bell shows unread; **Approvals** shows two (Noah's, and Maya's from step 8). | "The badge is the real count." | Approval |
| 10 | Open Maya's request → read her answers → **Approve**. | "One click, audited with his name and time." | Approve |
| **IT — Alex (window 2, after signing Jordan out)** | | | |
| 11 | Sign in as Alex. **Command Center**. | "Global health derived from the SLA position of every active ticket; nothing hand-entered." | See |
| 12 | Point at *Needs your attention*: 3 breaches, 1 at risk, unassigned work — Maya's new ticket among them. | "Ranked by operational severity; each row links to where it gets fixed." | Prioritise |
| 13 | Click **Review breaches** (opens Service Desk filtered `Breached`). Clear it, search `ops 1`. | "Filters live in the URL; an exact key comes first however it is typed." | Service Desk |
| 14 | Open Maya's ticket from step 6 (search `VPN still`). | "Three columns: context, conversation, properties — and a live clock." | Ticket Workspace |
| 15 | Right column: SLA panel — first response counting down. | "Only a public reply to the requester stops it; an internal note does not." | SLA |
| 16 | Left column: requester → click **Maya Chen**. | "Who is asking, what else they have open, what they own." | Requester |
| 17 | On her profile: department **Engineering** → open it. | "The team's service demand and who manages it — Jordan, which is why he approved." | Department |
| 18 | Back to the profile: **Assets** tab → **LAP-0001** → the service history lists this ticket. | "Asset ↔ ticket ↔ person, all three directions." | Asset |
| 19 | Browser back to the ticket. Assign to yourself, status *In progress*, save. | "Optimistic version — two agents cannot overwrite each other." | Act |
| 20 | **Analyze ticket** (Mock AI): summary, suggested category/priority, reasons quoted. Tick and **Apply**. | "It suggested; a named human accepted; the audit says who." | AI assist |
| 21 | **Draft a reply** → edit a sentence → *Copy into the reply box* → **Send reply**. | "Built from public material only; sending is my action." | Reply |
| 22 | Set **Resolved**. | "Resolution stops the clock; the requester is asked to rate." | Resolve |
| **Employee — Maya (window 1)** | | | |
| 23 | Bell: the reply and the resolution are there; open the ticket. | "Notified, without any ticket text leaving the system in the e-mail." | Notification |
| 24 | Rate it **5** with a short comment. | "Stored once per ticket; it feeds the next screen." | CSAT |
| **IT — Alex (window 2)** | | | |
| 25 | **Service Intelligence**: the strip, "no previous period to compare" where honest, the trend switch, the department × priority heat table, *limited* on small samples, alphabetical team table. Then **Reports → SLA performance → Export CSV**. | "Measured from stored rows under the same SLA rule as the desk. Comparisons only when both periods exist. The CSV is exactly the table." | Measure |
| 26 | Sign in as Jordan (or reuse window 2): **Administration → Audit log**, filter *AI* then *Tickets*: today's story is all there. Glance at **Security** ("facts, not switches") and **Workflow** (read-only, says so). | "Every step you watched is an append-only record written in the same transaction as the change." | Control |

Stop there. Questions usually go to SSO (roadmap, not faked), scale (10k tickets measured: lists
under 50 ms, analytics under 0.6 s), and what happens when things fail (pull the network cable on
window 1 and send a reply: the draft stays, the message says why, retry sends exactly one).

## Making it repeatable

- **Reset**: `npm.cmd run demo:reset` — empties every table, re-seeds the fictional organisation
  and rebuilds the search index. It refuses to run in production, against a non-local database, or
  if any non-demo account exists, so it cannot be pointed at real data by accident. ~20 seconds.
- **Re-seed only** (keeps what the demo added, refreshes the story rows): `npm.cmd run db:seed`.
- **Verify before starting** — sign in as Alex and check: Command Center shows *3 breached · 1 at
  risk*; Service Desk has 11 active tickets; Approvals (as Jordan) shows Noah's laptop pending; My
  Space (as Maya) shows 4 unread; Knowledge search `vpn` finds *Reconnect to the company VPN*.
- **If something was left half-done**: reset. Never edit rows by hand mid-demo.
- Production installations have `ALLOW_DEMO_SEED=false`, which disables both the seed and the
  reset at the configuration layer.
