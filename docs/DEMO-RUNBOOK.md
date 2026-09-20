# OpsPilot V2 — demo runbook (native Windows)

Everything the operator does around the demonstration itself. The demonstration is in
[DEMO-SCRIPT.md](DEMO-SCRIPT.md); the one-pager for the table is
[DEMO-CHEATSHEET.md](DEMO-CHEATSHEET.md).

This is the **native Windows path** — `start.bat` and the local PostgreSQL that comes with it. That
is the path validated on this machine ([RC1-HOST-VALIDATION.md](RC1-HOST-VALIDATION.md)). Docker is
out of scope for this release; do not use it for a demonstration.

---

## Before the demo

**The evening before, or at least an hour ahead**

1. **Power.** Plug the laptop in. Set the screen and sleep timeout long enough to cover the meeting.
2. **Reset the demo data** — this is the step that makes the demonstration repeatable:
   ```
   npm.cmd run demo:reset
   ```
   About six seconds. It empties every application table and re-seeds the fictional organisation,
   then rebuilds the knowledge index. It refuses to run in production, against a database anywhere
   but this machine, or if the database holds any account that is not a demo account — so it cannot
   be pointed at real data by accident.
3. **Start OpsPilot.** Double-click **`start.bat`** in the OpsPilot folder. Leave the console window
   open — closing it stops the application. Wait for:
   ```
   OpsPilot is up at http://localhost:5173
   ```
   A first run on a new machine sets things up and can take a few minutes. A normal start is well
   under a minute.
4. **Check that the story is there:**
   ```
   npm.cmd run demo:check
   ```
   Read-only — it changes nothing. It confirms the API and database are up, the four personas can
   sign in, the opening ticket, the pending approval, the knowledge article and the asset all exist,
   and that the dashboards have something to show. It prints today's ticket keys; copy them onto the
   cheat sheet. Anything **FAIL** means run `demo:reset` and check again.

**In the last ten minutes**

5. **Open the browser and sign in** — Chrome or Edge, one normal window and one private window (or
   two profiles), both at `http://localhost:5173`. Window A: Maya. Window B: Jordan.
6. **Warm the pages you are going to show.** Click once through My Space, Knowledge, the Service
   Catalog, Command Center, Service Desk, a ticket, Analytics, Reports and Administration. The first
   visit to each screen compiles and caches it; afterwards every screen renders in well under a
   second. This is warming a cache, not faking speed — your audience gets the same experience on
   their second visit as you get on your first.
7. **Tidy the desktop.** Close unrelated tabs and applications. Hide the bookmarks bar
   (**Ctrl + Shift + B**). Turn off browser and operating-system notifications, or switch Windows to
   focus assist. Decline the browser's offer to save a password — a password manager pop-up in the
   middle of a sign-in is the most common avoidable interruption.
8. **Set the display.** 1920 × 1080, browser zoom at 100 % (**Ctrl + 0**), sidebar expanded, light
   theme. If the room projector runs at 1366 × 768 the layout still holds: every demo screen fits
   that width without sideways scrolling.
9. **Have the password to hand** but out of sight. It is the `DEMO_PASSWORD` line of `.env`. Never
   put `.env` on the screen and never read it aloud.

**Do not** demonstrate from a screen-shared window that also shows your e-mail, and do not sign in
with a real account of your own — this workspace is fictional and should stay that way.

---

## During the demo

**Persona order** — Maya (employee) → Jordan (manager) → Alex (engineer) → Maya → Alex → Jordan.

**The story** — VPN problem → knowledge → service request → a real approval elsewhere in the queue →
Command Center → Service Desk → ticket workspace → person → department → asset → Ask OpsPilot →
reply → resolve → notification → rating → Service Intelligence → report → administration and audit.

**The entities you need** (on a freshly reset workspace)

| What | Where | Note |
| --- | --- | --- |
| Maya's seeded incident | **OPS-0001** *VPN disconnects during video calls* | In progress, Alex owns it, linked to LAP-0001 |
| The request you create live | **OPS-0021** *Cannot connect to the VPN from home* | P3 Medium, no approval, unassigned |
| The approval that is genuinely waiting | **OPS-0019** *Replacement laptop for Noah Williams* | With Jordan, because he manages Noah |
| The article | *Reconnect to the company VPN* | Network, published, 2-minute read |
| The device | **LAP-0001** Atlas 14 | Maya's, in use, in warranty |
| The department | Engineering | Managed by Jordan Patel |

Ticket keys are stable after a reset, but confirm them with `demo:check` rather than trusting this
table — a demonstration that was not reset first will number the new request differently.

**Two things the script depends on**

- A ticket must be **In progress** before it can be resolved. From Open, use **Change status → In
  progress** first; the Resolve button is deliberately disabled until then.
- The service you submit (*Wi-Fi or VPN problem*) needs **no approval**, and the catalog says so.
  The approval part of the story uses Noah's laptop request, which genuinely does. Do not pretend
  otherwise — the honesty is a selling point.

**Switching the theme**, if somebody asks: the moon icon in the header, or the account menu →
*Switch to dark theme*. Switch back before continuing; do not toggle repeatedly.

---

## If something goes wrong

| Situation | What to do |
| --- | --- |
| **The AI panel is slow or you would rather not wait** | Skip *Analyze ticket* and point at **Suggested knowledge** instead — it is already on screen and makes the same point. Mock AI does not call out to anything, so it is fast, but it is not worth waiting on stage. |
| **The approval was already decided** (someone ran through the demo before you) | Run `demo:reset` before the session. Mid-session, use *Requested by me* / *Completed* in the Approval Center to show the decided one, and say plainly that this request was already approved. |
| **Live updates stop** (the footer says *Live updates reconnecting…*) | Refresh the page and carry on. Do not claim a live update in that run. |
| **The new request does not appear in the queue** | Clear the Service Desk filters, or search the key from the confirmation screen. The filters live in the URL and a leftover filter is the usual cause. |
| **A screen looks stale** | Command Center has a **Refresh** button; everything else reloads with F5. Nothing in the demo needs a restart. |
| **The application stops responding** | Close the console window, double-click `start.bat` again, and use the time to answer a question. Data is in PostgreSQL and survives the restart. |
| **No internet** | Does not matter. The workspace, the database and mock AI are all local. Nothing in the demonstration reaches the internet; the only features that would are e-mail delivery (disabled here) and a real AI provider (not in use). |
| **Somebody asks to see failure handling** | Turn off the network adapter, type a reply and send it: the draft is kept and the message explains what happened. Turn the adapter back on and retry — exactly one reply is sent. |

Never edit the database by hand mid-demonstration. If the story has been damaged, finish on the
seeded material and reset afterwards.

---

## After the demo

1. **Stop the application** — press **Ctrl + C** in the OpsPilot console window, or close it.
2. **Reset for next time** — `npm.cmd run demo:reset`. Do this after a session rather than before
   the next one; it is one less thing to go wrong when somebody is waiting.
3. **Where things are if you need them**
   - Application output: the `start.bat` console window while it runs.
   - Database: `.local-db\` inside the project folder, started and stopped by the launcher.
   - Uploaded files: `uploads\`.
   - Backups: `npm.cmd run db:backup` writes to `backups\`; see
     [BACKUP-RESTORE.md](BACKUP-RESTORE.md).
   - Anything unexpected: `npm.cmd run doctor`, and
     [OPERATIONS-RUNBOOK.md](OPERATIONS-RUNBOOK.md) for startup errors and their exit codes.
4. **If you were asked for something OpsPilot cannot do**, write it down as a request rather than
   promising it. This release deliberately shows only what is implemented.

---

## Measured on this build

Rehearsed end to end against a freshly reset workspace, twice, with no manual repair between runs:
the request was created, approved elsewhere, worked, resolved and rated each time, and the second
run behaved exactly like the first.

Screen render times after warm-up, on a full page load: My Space 279 ms, Command Center 486 ms,
Service Desk 272 ms, Service Intelligence 993 ms, Reports 275 ms, Knowledge 255 ms. Every demo
surface was also checked at 1366 × 768 and none scrolls sideways. `demo:reset` takes about six
seconds, `demo:check` about two.

Those measurements come from the project's Linux verification environment running the same
development server and the same seeded data — **not** from this Windows machine. They are here to
say that nothing in the demonstration makes an audience wait; treat the Windows numbers as
"similar", and if you want certainty, watch the clock during your own warm-up pass.
