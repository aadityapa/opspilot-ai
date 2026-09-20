# OpsPilot demo — one page

**START** Double-click `start.bat` · wait for `OpsPilot is up` · **http://localhost:5173**
**BEFORE** `npm.cmd run demo:reset` (≈6 s) → `npm.cmd run demo:check` (read-only, <1 s; prints today's keys)
**STOP** Ctrl + C in the OpsPilot console window

## Sign in — password is the `DEMO_PASSWORD` line of `.env` (never show it)

| # | Persona | Account | Shows |
| --- | --- | --- | --- |
| 1 | **Maya Chen** · employee, Engineering | `employee@opspilot.example` | My Space, knowledge, catalog, her request, notifications, rating |
| 2 | **Jordan Patel** · manager + administrator | `admin@opspilot.example` | Approval Center, Administration, audit log |
| 3 | **Alex Morgan** · IT engineer | `engineer@opspilot.example` | Command Center, Service Desk, ticket workspace, Ask OpsPilot, analytics, reports |
| — | Noah Williams · second employee | `employee2@opspilot.example` | Only appears in the story; no need to sign in |

Window A = Maya all the way through. Window B = Jordan, then Alex, then Jordan again.

## The story — 13½ minutes

VPN problem → **knowledge first** → service request → *(real approval elsewhere)* → Command Center →
Service Desk → ticket workspace → person → department → asset → Ask OpsPilot → reply → resolve →
notification → **CSAT** → Service Intelligence → report → administration + audit.

| Time | Screen | The line that matters |
| --- | --- | --- |
| 0:00 | — | "Employee requests, IT operations, knowledge, assets, approvals and intelligence in one workspace." |
| 0:30 | My Space | "Her own work, not a ticket queue. One search box." |
| 1:30 | Knowledge | "The cheapest ticket is the one nobody raises." |
| 2:15 | Service + form | "She was never asked for a priority or an SLA." |
| 3:15 | My requests | "What happens next, in plain words." |
| 3:45 | Approvals | "Her incident needed no approval and said so. A laptop does." |
| 4:45 | Command Center | "Derived from the SLA position of every active ticket." |
| 5:45 | Service Desk | "Every signal drills into the work that answers it." |
| 6:30 | **Ticket workspace** | "Context, conversation, intelligence — and only a public reply stops the clock." |
| 8:30 | Person → dept → asset | "The issue, the person, the organisation and the device, three clicks apart." |
| 9:15 | Ask OpsPilot | "It suggests and stops. A named human accepts." |
| 10:00 | Reply + resolve | "The summary goes to her; the clock stops." |
| 10:45 | Maya's inbox | "She rates it where she already is." |
| 11:15 | Analytics | "Command Center: what needs action now. This: how delivery is performing." |
| 12:00 | Reports | "The rows behind the chart. The screen caps at 2,000; the CSV never does." |
| 12:30 | Admin + audit | "SSO says *not in this release*. We show what exists." |
| 13:00 | — | "One request touched every part of service operations, and the context was still attached at the end." |

## Keys after a reset — confirm with `demo:check`

```
OPS-0001  VPN disconnects during video calls     Maya · in progress · Alex · LAP-0001
OPS-0019  Replacement laptop for Noah Williams   waiting for Jordan's approval
OPS-0021  the request you create live            Cannot connect to the VPN from home
LAP-0001  Atlas 14, Maya's laptop, in warranty   Engineering, managed by Jordan Patel
Article   Reconnect to the company VPN           Network · 2 min · 3 of 4 found it helpful
```

## Two rules the product enforces

- **Open → In progress → Resolve.** Resolve is disabled until the ticket is in progress.
- **Wi-Fi or VPN problem needs no approval.** The approval step uses Noah's laptop request.

## If it wobbles

| | |
| --- | --- |
| AI slow or unwanted | Skip *Analyze* — point at **Suggested knowledge**, already on screen |
| Approval already decided | You did not reset. Use *Completed* and say so plainly |
| Live updates drop | Refresh; do not claim a live update in that run |
| New request not in the queue | Clear the Service Desk filters, or search the key |
| Application stops | Close the console, double-click `start.bat`, keep talking. No data is lost |
| No internet | Irrelevant — workspace, database and mock AI are all local |

## Never say

"AI resolves it automatically" · "integrates with ServiceNow / Okta / Microsoft" · "real-time
monitoring" · "better than <competitor>" · the demo password, out loud or on screen.
