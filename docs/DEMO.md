# Demo guide

Everything in the demo workspace is fictional and labelled as such in the footer of every page.
Before starting: `start.bat` (or `npm.cmd run setup` then `npm.cmd run dev:local`), and keep the
password from the `DEMO_PASSWORD` line of your `.env` to hand — it is generated on your machine and
is deliberately not printed in any document. AI runs in **mock** mode: no key, identical output
every time, labelled *Mock AI* in the interface. Say that early; it is a point in your favour.

## The four personas

| Sign in as | Who they are | What they show |
| --- | --- | --- |
| `employee@opspilot.example` | **Maya Chen**, Engineering. Has an open VPN incident assigned to Alex, a laptop (LAP-0001) and a docking station, and a history of resolved work. | The employee experience: My Space, the catalog, a request, Knowledge, the approvals she can see, her assets. |
| `employee2@opspilot.example` | **Noah Williams**, Sales. Raised a replacement-laptop request that is waiting for his manager's approval, and an open battery ticket. | A request that is genuinely pending, so the approval flow is real, not staged. |
| `engineer@opspilot.example` | **Alex Morgan**, IT Engineer. Owns most of the active queue, including a breached ticket and one at risk. | Operations: Command Center, Service Desk, Board, the ticket workspace, AI assistance, Service Intelligence and Reports. |
| `admin@opspilot.example` | **Jordan Patel**, Administrator and manager of IT and Engineering, so Noah's request lands with them. | Approvals from the manager's side and the whole Administration control plane. |

Ten more colleagues exist to be looked at, not signed in as. Each has a random password nobody is
given; the four accounts above are the only ones that can sign in.

## One repeatable journey (about twelve minutes)

The same twenty-four steps work every time on a freshly seeded database. Re-seed with
`npm.cmd run seed` if a previous run left the data changed.

**Employee — Maya**

1. Open `http://localhost:5173`. The sign-in page: no SSO buttons, no "create an account", because
   neither exists. Sign in as Maya.
2. **My Space.** The greeting, her open work with SLA state, "Needs your attention", the quick
   requests strip and the announcement. Every number is a link.
3. **Service Catalog** (Ctrl+K → "Request a service", or the sidebar). Search "laptop", open
   **New laptop**, note the approval route shown before anything is filled in. Do not submit — Noah
   already has one pending.
4. **Knowledge.** Search "vpn", open *Reconnect to the company VPN*. Table of contents,
   reading time, Helpful / Not helpful, "Still need help?" pointing at the right service.
5. **Ask OpsPilot** with "how do I reconnect to the company VPN?" — an answer built only from
   articles Maya may read, with clickable citations. Then "how many days of annual leave do I get?"
   — *Not enough evidence to answer*, and an offer to raise a ticket instead of a guess.
6. **My requests.** Open *VPN disconnects during video calls*: status, the assigned engineer, the
   public reply from Alex, the Service level panel with the first-response target already met.
7. **Assets → LAP-0001.** Lifecycle, warranty, and the service history that includes step 6's
   ticket. Sign out.

**Employee — Noah, then the manager — Jordan**

8. Sign in as Noah. My Space shows *Replacement laptop for Noah Williams* as **Awaiting
   approval**. Open it: the answers he gave, and who it is waiting for. Sign out.
9. Sign in as Jordan. The Approvals badge shows one. **Approvals → Needs my approval →** open the
   request, read the form answers, **Approve**. The request moves on; the audit log records who
   approved it and when. Sign out.

**Operations — Alex**

10. Sign in as Alex. **Command Center.** Global operational health derived from the SLA position of
    every active ticket; "Needs your attention" ranked by operational severity; the breached and
    at-risk figures each link to the Service Desk filtered the same way.
11. **Service Desk.** Filter SLA → *Breached*. Three tickets, each with its own reason. Clear it,
    search `ops 1` — the exact key comes first however it is typed.
12. **Board.** Drag *Laptop battery does not hold a charge* from Open to In progress; the workflow
    rules decide where a card may land, and the activity records the move.
13. Open **OPS-0001** (Maya's VPN ticket). The three-column workspace: context, conversation,
    properties and the live SLA clock.
14. **Analyze ticket** (Mock AI). Summary, suggested category and priority, reasons quoted from the
    ticket. Nothing on the right has changed. Tick the suggestions you accept and **Apply** — the
    audit line names you.
15. Add an **internal note**. It never reaches Maya, and it does not satisfy the first-response
    target; only a public reply does.
16. **Draft a public reply**, edit a sentence, copy it into the reply box, **Send reply**. Set the
    ticket **Resolved**. Maya can now rate it.
17. Sign in as Maya in a second window and rate the ticket **5**. Back as Alex, the rating appears
    in the activity and in Service Intelligence.
18. **Service Intelligence.** Executive strip with denominators and "no previous period to compare"
    where there is none; switch the trend between ticket volume, resolution, SLA, CSAT and backlog;
    demand by department and the department × priority heat table; recent breaches; the age of open
    work; ratings marked *limited* while the sample is under five; team workload listed
    alphabetically, with the note that it is not a ranking.
19. **Reports → SLA performance.** Same filters, summary strip, the rows behind the analytics.
    **Export CSV** downloads exactly those rows. Sign out.

**Platform — Jordan**

20. Sign in as Jordan. **Administration → Overview**: the six areas and what each configures.
21. **Accounts & access.** Search "Maya", open **Manage**: disable, unlock, reset link, sign out
    everywhere, export, erase. Then **People directory** for the organisational side — the
    distinction is deliberate.
22. **Workflow.** Types, the transition table with what each does to the SLA clock, the impact ×
    urgency matrix. Read-only in this release, and the page says so.
23. **Security.** The protections in force, read from the server, and the honest note that SSO,
    SCIM and IP allow-lists are not in this release.
24. **Audit log.** Filter *AI* to find step 14's accepted suggestion (`AI_TRIAGE_ACCEPTED`), then
    *Tickets* for step 9's approval. Every row was written inside the same transaction as the change
    it describes.

## Optional extensions

- **Live updates** — with Alex's Service Desk open in one window, change a ticket in another; the
  list updates without resetting the filters or the search box. Stop the server and the footer
  shows *Live updates reconnecting…*; start it again and a toast says they are restored.
- **Restricted by URL** — as Maya, type `#/admin` or `#/analytics` into the address bar: a 403 page,
  and the API refuses the calls behind it as well.
- **Stale suggestions** — run Analyze, edit the ticket in another tab, then press Apply. It refuses
  and asks you to analyse again.
- **AI switched off** — set `AI_MODE=disabled` and restart. Tickets, SLA and dashboards are
  unaffected; the AI panel says the feature is off.
- **Mobile** — the same journey at 390 px wide; nothing scrolls sideways.

## Interview talking points

Why the model gets no tools, and what that removes from the threat model. Why permission filtering
lives in the retrieval query rather than in a post-filter. Why citations are verified twice. Why
abstention is enforced by the server rather than requested from the model. Why every analytics
comparison needs both periods to exist, and why there is no at-risk trend (at-risk is a live
position; no snapshots are stored to reconstruct it from). Why team workload is alphabetical. Why the
Security page shows facts rather than switches. Why token usage is measured but cost is never
estimated.
