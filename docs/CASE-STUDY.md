# OpsPilot AI — case study

A four-phase build of an IT helpdesk with reviewed AI assistance. Written for someone deciding
whether the engineering behind it is sound, so it leads with what was measured and what was wrong.

**Status: a working local application with a demonstrable end-to-end workflow. Not deployed, no
users, no production data.** Every figure below comes from a run recorded in
[VALIDATION.md](VALIDATION.md); every number not measured is marked as such.

---

## The problem

A company of 50–200 people has IT requests arriving through email, chat and corridor conversations.
Nothing is tracked, priority is whoever asked most recently, and the same five questions get answered
individually every week. Commercial helpdesks solve this, but they are priced and shaped for larger
organisations.

Three users:

- **Employees** raise requests and want to know what is happening. Most of their questions already
  have a documented answer.
- **Engineers** triage, investigate and resolve. Their time goes on repeat questions and on writing
  the same reply again.
- **Administrators** manage accounts, hardware, service-level targets and the knowledge base.

## What was built

| Phase | Delivered |
| --- | --- |
| 1 | Auth with server-side sessions, three roles, the full ticket lifecycle, dashboards |
| 2 | Assets, internal notes, audit timeline, SLA timers, permission-aware knowledge base, notification outbox |
| 3 | AI provider boundary, ticket triage, conversation summaries, reply drafts, knowledge answers with verified citations |
| 4 | Release validation: reproducible setup, measured retrieval performance, abstention behaviour, honest documentation |

One repository, one lockfile: React + TypeScript + Vite, Express, PostgreSQL via Prisma, Zod
validation shared between client and server, Vitest and Playwright, Docker Compose for local
dependencies. No microservices, no separate AI service — a deliberate choice for a project this size.

---

## Technical decisions worth defending

### Permission filtering happens before retrieval, not after generation

The security property that matters for a RAG feature is which passages reach the prompt. Article
visibility and status are conditions inside the ranking SQL, so a support-only, draft or archived
passage is never a candidate:

```sql
WHERE a.status = 'PUBLISHED'
  AND (:employeeOnly = false OR a.visibility = 'EMPLOYEE')
  AND c."articleVersion" = a.version
```

Nothing depends on the model keeping a secret it was shown. After the answer comes back, every
citation is re-checked against current rows, so an article restricted between retrieval and response
is dropped rather than returned. There is a test that archives the sources mid-request and asserts
the answer is withheld.

### The model is given no tools, and no model output changes a record

Triage returns suggestions. Applying them is a *separate* authenticated request that re-checks the
role, revalidates category and priority against the database, enforces the optimistic version, and
compares a fingerprint of the exact text that was analysed — so a suggestion computed against a
different version of the ticket is refused with a 409 rather than applied silently. The acceptance is
audited by name: *"Alex Morgan accepted AI triage suggestions (mock provider…)"*.

Reply drafts are text in an editable box. They become replies only through the same endpoint a
hand-written reply uses.

### Abstention is enforced by the server, not requested from the model

Phase 3 asked the model to decide whether the evidence supported an answer. Evaluation showed that
was not enough: the system answered from a weakly related article whenever any passage cleared the
retrieval floor. Phase 4 added two model-independent checks that can only ever *withhold* an answer —
one before the call (is the best passage close enough, and does it share the question's terms?) and
one after (does each cited passage share substance with the answer that was written?).

### Instruction-shaped text is stripped from evidence

An injected paragraph inside a *permitted* article was written to name restricted material. That gave
it strong term overlap with restricted-topic questions, so it was retrieved and treated as evidence.
Nothing restricted leaked — but the system answered where it should have abstained. Passages are now
filtered for instruction-shaped sentences before they are used as evidence, quoted as an excerpt, or
sent to the model.

### Exact ranking, kept because it was measured

Retrieval ranks with an exact cosine SQL function rather than a pgvector index. That is a performance
claim, so it was benchmarked on a seeded fictional corpus — and the first measurement was bad:
**1,666 ms for 800 passages.** The function computed three correlated subqueries per row and the
query called it twice per row. Rewriting it as a single `unnest … WITH ORDINALITY` pass and computing
the distance once in a `LATERAL` gave a **13.6× improvement**, with numerically identical results.

At the production embedding width of 1536 dimensions:

| Articles | Passages | p50 latency |
| --- | --- | --- |
| 10 | 40 | 30 ms |
| 50 | 200 | 148 ms |
| 200 | 800 | 609 ms |
| 500 | 2,000 | 1,468 ms |

Exact ranking suits a knowledge base up to roughly 100–200 articles, which is the stated target. The
crossover where pgvector earns its complexity is documented rather than guessed —
see [RETRIEVAL.md](RETRIEVAL.md).

---

## Defects found, and how

Most were found by tests and by looking at screenshots, not by reading code.

| Defect | How it surfaced | Why it mattered |
| --- | --- | --- |
| Asset detail page crashed on navigation | New browser test | A data hook returned the previous route's payload for one render, so a list response was parsed as a record |
| Saving a ticket silently unlinked its asset | Reviewing a screenshot | An uncontrolled `<select>` fell back to "No linked asset" while options loaded, so any unrelated edit dropped the link |
| Every AI failure returned HTTP 500 | Usage-limit test | `AiError` carries 503/504/429/502, but the Express handler did not recognise the type — the interface could not tell "try again" from "broken" |
| A textarea's value became its accessible name | Browser test, then DOM inspection | React writes a controlled value into text content; the reply box took its name from a wrapping `<label>`, so a screen reader announced the whole draft as the field label |
| Retrieval ranking was 13.6× slower than necessary | Benchmark | See above. The first benchmark was itself wrong — it measured the application database instead of the benchmark one |
| A pgvector index "could be added without a migration" | Schema inspection in Phase 4 | **False claim, corrected.** `embedding` is `double precision[]`; pgvector indexes need a `vector` column |
| Mobile navigation overflowed at 390 px | Existing Phase 1 test failing | Phase 2 raised the workspace from four destinations to six and the nav did not wrap |
| The evaluation canary was not unique to restricted content | Evaluation run | Four cases reported apparent disclosures that were really echoes of permitted text |
| The new destructive-write guard blocked legitimate test databases | Running the suite after adding it | Browser tests create ordinary accounts, which is what a real workspace looks like — resolved with an explicit one-time claim command |

The last one is worth dwelling on: a safety control that blocks correct usage gets disabled by the
person it inconveniences. Adding `npm run db:claim-test` kept the guard strict *and* usable.

---

## Measured results

From the Phase 4 run on Node 24.20.0 and PostgreSQL 17.4:

- **132 API and unit tests**, **20 browser tests**, 0 failures, 0 dependency vulnerabilities.
- **18/18 evaluation cases matched**, including **7/7 held-out cases** written after the evidence
  thresholds were chosen. Every abstention and non-disclosure expectation is an assertion, not a
  score.
- **13.6× retrieval speed-up**, before-and-after on the same seeded corpus.
- Fresh install and Phase-2-to-Phase-3 upgrade both verified: every ticket, reply, internal note and
  article preserved byte-for-byte.

### What "18/18" does and does not mean

It means the system passed these eighteen fictional cases with the deterministic mock provider. It is
not a measure of AI safety. The mock is a lexical hashing vectoriser with rule-based responses; it
exercises the application's permissions, validation and abstention wiring, and says nothing about how
a real language model would answer. **No call has ever been made to a real AI provider from this
project.** The OpenAI client is verified against a stubbed transport, which proves it speaks the
documented protocol and nothing about model quality.

---

## Remaining limitations

Stated because a portfolio project that hides these is less credible, not more.

- **No real-provider evaluation.** Opt-in and documented (`npm run eval:real`), never run.
- **No container verification.** Docker was unavailable throughout. `npm run verify:containers`
  scripts every check — PostgreSQL 18, Mailpit SMTP capture, restart, fresh install, upgrade — and
  none of it has been executed.
- **PostgreSQL 17 tested, 18 pinned.** Nothing depends on an 18-only feature; the pinned image is
  unexercised.
- **Prompt injection is mitigated, not solved.** The tested attacks were contained. The controls that
  actually hold are structural: no tools, permission filtering before retrieval, citation
  revalidation, human approval.
- **Redaction is best-effort** pattern matching and will miss unusual secret formats.
- **No production hardening**: no SSO or MFA, no password reset, no multi-instance rate-limit store,
  no attachments, no business-hours SLA calendars, single company per installation.
- **Accessibility** is limited to what the browser tests assert — labelled controls, keyboard entry,
  focus, no horizontal overflow at 390 px. No full WCAG audit.

## What I would do next

1. Run `verify:containers` and `eval:real` on a machine with Docker and a key, and replace the
   unverified rows in VALIDATION.md with measured output.
2. Decide pgvector on evidence: if a target knowledge base exceeds ~200 articles, do the migration in
   RETRIEVAL.md and re-benchmark — including whether approximate search under a hard permission
   filter under-returns.
3. Attachments, which need authorization, private storage, type and size limits, safe download
   handling and a decision about malware scanning before any upload endpoint exists.
