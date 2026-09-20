# OpsPilot V2 — enterprise sales demonstration

**13½ minutes, one story, four people.** Everything on screen is computed from what the workspace
actually holds; the demonstration creates a real request and follows it to a real rating. Nothing is
staged, mocked up or pre-recorded.

Before the audience arrives, work through [DEMO-RUNBOOK.md](DEMO-RUNBOOK.md). The one-page version
to keep beside the laptop is [DEMO-CHEATSHEET.md](DEMO-CHEATSHEET.md).

**Setup.** Two browser windows side by side, both at `http://localhost:5173`:

| Window | Signed in as | Used for |
| --- | --- | --- |
| **A — the employee** | Maya Chen, `employee@opspilot.example` | the self-service half of the story |
| **B — IT and the business** | Jordan Patel, then Alex Morgan | approval, operations, intelligence, governance |

Window B changes person twice. Sign out and in; it takes six seconds and makes the role change
obvious. The password is the `DEMO_PASSWORD` line of `.env` — never read it aloud, never show `.env`.

**Say once, early:** AI runs in **mock** mode. No key, no network call, the same answer every time.
It cannot fail on stage, and the interface labels it *Mock AI* rather than pretending otherwise.

---

## 00:00–00:30 · Opening

**SAY**

> "OpsPilot is an enterprise service operations platform. It connects employee requests, IT
> operations, knowledge, assets, approvals and service intelligence in one workspace — so the person
> asking for help, the engineer fixing it, and the executive measuring it are all looking at the
> same system of record.
>
> Rather than describe it, I'll take one employee problem and follow it end to end. Everything you
> see is live data from this workspace."

Then go straight to the product. No title slide, no architecture diagram.

---

## 00:30–01:30 · The employee's front door

**PERSONA** Maya Chen, Engineering — **SCREEN** My Space (window A, already signed in)

**CLICK** Nothing yet. Let the page sit for a beat.

**SAY**

> "This is what an employee sees. Not a ticket queue — their own work. Two things need her
> attention, one request is open, two messages are unread. One search box covers services,
> knowledge and her own requests, so she never has to know whether her problem is an 'incident' or a
> 'service request'. She doesn't learn ITSM vocabulary to get help."

**HIGHLIGHT** the greeting and the attention count · the single help search · *My work* (needs
approval / my requests / unread) · *Quick requests* · announcements from IT.

**MESSAGE** Employee service experience, not a ticket-system front end.

---

## 01:30–02:15 · Knowledge first

**PERSONA** Maya — **SCREEN** Knowledge

**CLICK** Press **Ctrl + K** → type `vpn`. Show that the palette reaches tickets, knowledge and
services at once. Press **Escape**, then the sidebar **Knowledge** → search box → `vpn` → open
***Reconnect to the company VPN***.

**SAY**

> "Her VPN keeps dropping. Search finds the article before it finds anything else, because the
> cheapest ticket is the one nobody has to raise. The article is written for her, not for IT:
> contents down the side, two-minute read, and a helpfulness vote that is recorded per person."

**HIGHLIGHT** the table of contents · reading time · *3 of 4 people found this helpful* · the
security warning inside the article · **Still need help?** in the right-hand column, pointing at the
services in the article's own category.

**MESSAGE** Deflection first. OpsPilot tries to answer before it creates work.

*Do not overstay. 45 seconds.*

---

## 02:15–03:15 · When knowledge is not enough

**PERSONA** Maya — **SCREEN** Service detail → request form

**CLICK** *Still need help?* in the article's right-hand column → **Wi-Fi or VPN problem** → read the
service card → **Start request**. Fill it: *Where does it happen?* → **Home**; *Since when?* →
`this morning`; *Summary* → `Cannot connect to the VPN from home`; *Notes for IT* → one sentence
saying the article did not fix it. → **Review request** → **Submit request**.

**SAY**

> "The catalog tells her what she's about to get into before she types anything: this is handled as
> an incident, it needs no approval, and here is what she'll be asked. Then three steps — details,
> review, submitted — and a request number she can quote.
>
> Notice what she was never asked. No priority. No SLA. No assignment group. This service carries
> its own priority, set once by whoever configured the catalog, so every report of it starts with
> the same target — and the clock started on submission."

**HIGHLIGHT** *Incident · No approval needed* on the service card · the three-step progress · the
review screen · the request key on the confirmation (**OPS-0021** on a freshly reset workspace).

**MESSAGE** The employee describes the problem. OpsPilot does the classification.

*Optional, 15 seconds, if the room is interested in deflection:* go back and take **Report an IT
issue** instead — the free-text path. As you type the title and description, a **This might help
first** panel appears underneath them with the matching articles, and this is the path where the
employee is asked how many people are affected and how quickly it is needed — the impact and urgency
that the priority matrix turns into a priority. Say: "even when somebody insists on writing a
ticket, we put the answer in front of them first." Then return to the catalog path.

---

## 03:15–03:45 · She can see where it is

**PERSONA** Maya — **SCREEN** My requests

**CLICK** Sidebar **My requests** → open the new request.

**SAY**

> "One place for everything she has asked IT for, with what happens next in plain words — not a
> status code. That single line, 'IT investigates and keeps you posted', is the difference between a
> person chasing IT and a person getting on with their job."

**HIGHLIGHT** status and next step · the service level panel in the employee's language — *first
reply*, *completion*, no countdown timers · who is involved.

**MESSAGE** Transparency without operational jargon.

---

## 03:45–04:45 · Approval, where the business actually requires one

**PERSONA** Jordan Patel, administrator and the manager of IT and Engineering — **SCREEN** Approval
Center (window B)

**CLICK** Sign in as Jordan → sidebar **Approvals** → the **Needs my approval** tab shows **1** →
**Review** on *Replacement laptop for Noah Williams* → read the business justification → **Approve**
→ confirm in the dialog.

**SAY**

> "Maya's incident needed no approval, and OpsPilot said so up front rather than inventing a step.
> A laptop purchase is different. Noah asked for one two days ago, and because the catalog routes
> that service to the requester's own manager, it is sitting with Jordan — with the business
> justification, the model, the date it is needed by, and the request it belongs to.
>
> One decision, one click, recorded with his name and the time."

**HIGHLIGHT** the tab count is the real number of decisions waiting · the request context in the
review dialog · *Approve* / *Reject* with an optional note · the confirmation naming what happens
next.

**MESSAGE** Governance where the workflow calls for it, and nowhere else.

---

## 04:45–05:45 · What operations sees

**PERSONA** Alex Morgan, IT Engineer — **SCREEN** Operations Command Center

**CLICK** Sign out of Jordan, sign in as Alex → **Command Center**.

**SAY**

> "This is the operations view, and it is derived — every figure comes from the SLA position of
> every active ticket at this moment. Nothing here is typed in by a team lead on a Friday afternoon.
>
> I'm not going to read the dashboard to you. The part that matters is *Needs your attention*:
> OpsPilot has already ranked what requires intervention, and every row goes straight to the work.
> Including Maya's request, which arrived a minute ago and has no owner yet."

**HIGHLIGHT** Service Operations Pulse (active, unassigned, at risk, breached, MTTR, SLA compliance,
CSAT) · Global operational health with its three-way split · Service areas by category · *Needs your
attention* · Ticket flow, created against resolved.

**MESSAGE** Leadership sees what needs action now, not a wall of charts.

*45–60 seconds. Resist explaining every tile.*

---

## 05:45–06:30 · From signal to queue

**PERSONA** Alex — **SCREEN** Service Desk

**CLICK** *Needs your attention* → **Assign owners** (opens the Service Desk already filtered to
unassigned work). Point at the filters. Clear it and search `vpn`.

**SAY**

> "The dashboard is not a separate reporting product — every signal drills into the work that
> answers it. This is the same queue the desk works all day: saved views, SLA countdown per row,
> priority, owner, and filters that live in the URL, so a view can be pasted into a chat message."

**HIGHLIGHT** the filtered arrival · queue tabs (My work / Unassigned / At risk / Breached) ·
the live SLA countdown column · saved views · assign and status without leaving the list.

**MESSAGE** One queue, every route into it.

---

## 06:30–08:30 · The ticket workspace

**PERSONA** Alex — **SCREEN** Ticket workspace, Maya's new request

**CLICK** Open *Cannot connect to the VPN from home* → **Assign** → *Alex Morgan (me)* → **Change
status** → *In progress*.

**SAY**

> "Three columns, and they answer three different questions. On the left, what this ticket *is*.
> In the middle, the conversation with the requester — with internal notes kept separately and
> marked as never visible to her. On the right, what OpsPilot knows that might help.
>
> The clock is real: first response and resolution, against the policy snapshot taken when the
> ticket started, so changing a policy tomorrow never rewrites yesterday's performance. And only a
> public reply stops the response clock. An internal note does not, which is exactly right."

**HIGHLIGHT** properties and the impact × urgency matrix · requester, assignee, service, priority ·
the service-level panel and the policy snapshot note · conversation against internal notes ·
attachments that always download and never execute · the optimistic version behind *Save changes*,
so two engineers cannot silently overwrite each other.

**MESSAGE** Everything an engineer needs in one screen, with the guard rails the enterprise needs.

*This is the most important screen in the demonstration. Give it two minutes.*

---

## 08:30–09:15 · The context most tools make you go and find

**PERSONA** Alex — **SCREEN** Person → Department → Asset

**CLICK** In the ticket header, click **Maya Chen** → on her profile, click **Engineering** →
browser **back** to her profile → the **Assets** tab → **LAP-0001**.

**SAY**

> "Who is asking. What else they have open. Which department carries the demand, and who manages it
> — Jordan, the same person who approved a laptop a moment ago, because approvals follow the
> requester's own manager. And the actual device, with its warranty and its own service history,
> including this ticket.
>
> I'm moving fast on purpose. The value isn't any one of these screens. It's that the issue, the
> person, the organisation and the hardware are one connected record, three clicks apart."

**HIGHLIGHT** the requester's other open work · the department's demand and its manager · the asset's
warranty, owner and ticket history.

**MESSAGE** Connected context, not four separate modules.

---

## 09:15–10:00 · Ask OpsPilot, on the ticket

**PERSONA** Alex — **SCREEN** back on the ticket (browser back, twice)

**CLICK** Right-hand panel → **Analyze ticket**. Then point at **Suggested knowledge**.

**SAY**

> "Mock AI, so this is the same every time. It proposes a category and a priority and quotes the
> words in the ticket that led it there — then stops. Nothing on the right has changed anything on
> the left. I tick what I accept and apply it, and the audit log records that a named human made
> that decision.
>
> And underneath, the knowledge the ticket's own words match — the article Maya already read, plus
> one more. The assistant is on the engineer's desk when it is wanted; it is not a chatbot that
> intercepts the conversation, and it cannot act on its own."

**HIGHLIGHT** suggestion with reasons · explicit accept-and-apply · suggested knowledge · the usage
counter and the model name shown honestly.

**MESSAGE** Reviewed assistance. The engineer stays accountable.

---

## 10:00–10:45 · Resolution

**PERSONA** Alex — **SCREEN** ticket → resolve dialog

**CLICK** **Draft a public reply** → edit a sentence → *Copy into the reply box* → **Send reply**.
Then **Resolve** → type the resolution summary → **Resolve ticket**.

**SAY**

> "The draft is built only from material the requester is allowed to see, and sending it is my
> action, not the model's. Watch the first-response clock settle as it goes.
>
> Resolving asks for one thing: a summary in the requester's language. It is sent to her as a public
> reply, the ticket moves to resolved, and she is asked to rate it. No resolution codes, because
> this workspace does not use them — and the dialog says so rather than demanding one."

**HIGHLIGHT** first response **MET** · the resolution summary going to the requester · resolved
state with reopen still available.

**MESSAGE** Closing the ticket and closing the loop with the person are the same action.

---

## 10:45–11:15 · Back to the employee

**PERSONA** Maya — **SCREEN** window A: notifications → the request

**CLICK** The bell (unread) → open the update → rate **5 stars** → add a line → **Send rating**.

**SAY**

> "She was notified, she can read exactly what was done, and she rates it in the same place. No
> survey e-mail three days later that nobody answers. That rating is stored once per ticket and is
> the number leadership sees next."

**HIGHLIGHT** the inbox entry · the resolution in her own request · the rating, stored and shown
back.

**MESSAGE** The service loop closes where the employee already is.

---

## 11:15–12:00 · Service Intelligence

**PERSONA** Alex — **SCREEN** Analytics

**CLICK** Sidebar **Analytics**. Switch the trend between *Ticket volume*, *Resolution*, *SLA* and
*CSAT*. Point at the department × priority table.

**SAY**

> "The Command Center answers *what needs action now*. This answers *how is service delivery
> performing* — demand, SLA, time to resolve, satisfaction, backlog, over the period you choose.
>
> Two things worth noticing. Where there is no previous period to compare, it says so instead of
> printing a green arrow. And small samples are marked *limited* rather than dressed up as a trend.
> A number here is one you can take to a service review."

**HIGHLIGHT** the executive strip with its denominators · *no previous period to compare* ·
department demand and the priority heat table · team workload, alphabetical and explicitly not a
ranking.

**MESSAGE** Measurement you can defend, including where the data is thin.

---

## 12:00–12:30 · Reports

**PERSONA** Alex — **SCREEN** Reports → SLA performance

**CLICK** **Reports** → **SLA performance** → point at the summary → **Export CSV**.

**SAY**

> "Analytics is for understanding. Reports is the evidence underneath it: the same filters, the rows
> behind the chart, and an export that carries every one of them. The screen stops at two thousand
> rows and says so; the CSV is never truncated."

**HIGHLIGHT** the same filter set as analytics · summary and detail together · the downloaded file
(`opspilot-sla-30d-<date>.csv`).

**MESSAGE** Every chart can be traced back to rows.

*Under 30 seconds.*

---

## 12:30–13:00 · Governance

**PERSONA** Jordan — **SCREEN** Administration

**CLICK** Sign in as Jordan (window B) → **Administration** → glance at **Accounts & access**,
**Roles & permissions**, **Workflow**, **Security** → **Audit log**. Newest first, so the last
quarter of an hour is at the top; use the action filter for *AI*, then *Tickets*, to pick the story
out.

**SAY**

> "The control plane: who has access, what each role may do as the API enforces it, the ticket
> workflow, and the protections in force read from the server rather than shown as switches that do
> nothing.
>
> And the audit log — every step you just watched, written in the same transaction as the change it
> describes. Including the approval and the AI suggestion a human accepted.
>
> One more thing, and it's deliberate: Security says single sign-on, SCIM and IP allow-lists are
> **not in this release**. OpsPilot shows what is genuinely configured. It does not draw settings
> that don't exist."

**HIGHLIGHT** the six administration areas · roles as the API enforces them · *Not in this release* ·
the audit trail of the last thirteen minutes.

**MESSAGE** An enterprise can see exactly what it is buying.

---

## 13:00–13:30 · Closing

**SAY**

> "One employee request. In thirteen minutes it went through self-service, knowledge, a catalog
> service, an approval where the business required one, an operations queue, an engineer's workspace
> with the person, the department and the device attached, reviewed AI assistance, resolution,
> a satisfaction rating, service analytics, an exportable report and a governance trail.
>
> Nobody re-entered anything, nothing was copied between systems, and the context was still attached
> at the end of the journey — because it is one operating environment rather than a set of tools
> pointed at each other. That is the whole argument for OpsPilot."

Stop. Take questions.

---

## If you have less time

| Cut | Saves | Cost |
| --- | --- | --- |
| The palette search at 01:30 (go straight to Knowledge) | 15 s | little |
| Department and asset at 08:30 (person only) | 20 s | the connected-context point weakens |
| Reports at 12:00 | 30 s | analytics still makes the measurement point |
| The employee rating at 10:45 | 30 s | the loop does not visibly close |

Cutting the ticket workspace or the Command Center is not worth doing; they carry the argument.

## Questions that come up, and the honest answers

**"Does it do single sign-on?"** Not in this release. It is on the roadmap and the Security page
says so rather than showing a dead switch. Accounts are provisioned by an administrator; there is no
self-registration.

**"Does the AI resolve tickets by itself?"** No, and it is not built to. It suggests, cites, and
stops; a named person accepts or ignores it, and the audit log records which. In this demonstration
it runs in mock mode — deterministic, no external call.

**"Does it integrate with <our tool>?"** There are no productised integrations in this release. The
API is documented ([API.md](API.md)) and the data model is open.

**"How does it scale?"** Measured on a 10,000-ticket dataset: list queries 42 ms, analytics 0.58 s,
the Command Center summary 60 ms ([RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md), row 21). The demo
workspace is deliberately small so the story stays followable.

**"What happens when something fails?"** Worth showing if asked: turn off the network on the
employee window and send a reply — the draft is kept, the message explains what happened, and a
retry sends exactly one reply. See [DEMO-RUNBOOK.md](DEMO-RUNBOOK.md), *If something goes wrong*.

## Language

Say: enterprise service operations · employee service experience · Operations Command Center ·
Service Desk · Service Intelligence · Service Catalog · knowledge · asset context · governance ·
live ticket updates · SLA state · service demand.

Do not say: ticketing portal · help desk website · admin dashboard · real-time monitoring (the data
is service operations data, not infrastructure telemetry) · AI-resolved · integrates with anything
that is not implemented. Do not compare OpsPilot to a named competitor; the argument is the
connected journey you have just shown, not somebody else's product.
