# LinkedIn launch post — draft

**Not published.** This is a draft for you to edit and post yourself. Replace both placeholders
before posting.

- `<REPO-URL>` — your public repository
- `<DEMO-URL>` — a hosted demo, **or delete that line entirely** if you are not hosting one

Two things to keep as they are, because they are what make the post credible: every number is one
you can reproduce from the repository, and the post says plainly that there are no users and no
production deployment. Do not add invented adoption, savings or accuracy figures.

---

## Draft

I built OpsPilot AI — an IT helpdesk with AI assistance that a human always reviews.

The interesting part wasn't adding AI. It was deciding what the AI is not allowed to do.

Three rules the code enforces, rather than asking the model to respect:

→ **The model gets no tools.** No shell, no database access, no email. It returns text that the
server validates. That removes most of the threat surface before you write a single prompt.

→ **Permissions are applied before retrieval, not after generation.** Article visibility is a
condition in the ranking query, so a restricted passage never reaches the prompt. Nothing depends on
the model keeping a secret it was shown. Every citation is re-checked against current permissions
before the answer is returned.

→ **Nothing the model produces changes a record.** Triage returns suggestions; applying them is a
separate request that revalidates permissions, enforces the version, compares a fingerprint of the
analysed text, and writes an audit entry naming the engineer who accepted it.

A few things I got wrong, and fixed:

• I claimed a pgvector index could be added without a migration. It couldn't — the column is
`double precision[]` and pgvector needs a `vector` column. Corrected in the docs.

• I described exact cosine ranking as "fast" without measuring it. When I did, it was 1,666 ms for
800 passages. Rewriting the SQL as a single-pass `unnest … WITH ORDINALITY` made it 13.6× faster,
with identical results. The benchmark is in the repo, and the crossover point where pgvector becomes
worth it is documented instead of guessed.

• My evaluation set had a canary string in both a restricted and a public article, so four cases
reported leaks that weren't leaks. Fixing the dataset is what made the result mean anything.

Where it stands: 132 API/unit tests, 20 browser tests, and an 18-case evaluation covering answerable
questions, insufficient evidence, restricted knowledge and prompt injection — including 7 held-out
cases written after the thresholds were set. All passing.

What it is not: deployed, used by anyone, or evaluated against a real model. It runs a deterministic
mock provider by default, labelled as such in the interface. The OpenAI client is verified against a
stubbed transport — that proves it speaks the documented protocol, not that a real model answers
well. I've written that limitation into the README rather than leaving someone to discover it.

Stack: React, TypeScript, Express, PostgreSQL, Prisma, Zod, Vitest, Playwright, Docker Compose.

Code: <REPO-URL>
Demo: <DEMO-URL>

Happy to talk through any of the decisions — especially the ones I'd make differently.

#SoftwareEngineering #TypeScript #PostgreSQL #AI #RAG #ITSM

---

## Notes before you post

**Length.** The draft is on the long side for LinkedIn. If you want it shorter, cut the "things I got
wrong" section to the pgvector item alone — it is the strongest of the three because it is a
correction of your own published claim.

**The honesty is the differentiator.** Most portfolio AI posts claim accuracy percentages nobody can
check. Saying "no real model has been evaluated, here is exactly what was" is more convincing to an
engineer reading it, and it is the thing you can defend in an interview.

**If you add a demo link**, seed it with the fictional data and leave `AI_MODE=mock`. It costs
nothing, is deterministic, and the interface labels it — so nobody can mistake the mock for model
output.

**Expect two questions**, and have the answers ready:
- *"Why not pgvector?"* → docs/RETRIEVAL.md, with the measured crossover point.
- *"How do you know the AI is safe?"* → I don't, and I say so. Here is what is enforced structurally,
  and here is what is mitigated but unproven.
