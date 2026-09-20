# Evaluating the knowledge answers

## What is being evaluated, and what is not

The evaluation measures **the application's behaviour around a model**, not the model. It asks
whether permissions hold, whether the system abstains when it should, and whether citations support
what was written. It cannot tell you how good a real language model's prose is, and it does not try.

Run it with `npm.cmd test`; it is part of the normal suite. Against a real provider, opt in with
`npm.cmd run eval:real`.

## The dataset

`tests/eval/dataset.json` — eight fictional articles and eighteen cases. Nothing describes a real
company, person or system.

Articles cover every visibility and status combination that matters: employee-visible published,
support-only published, draft, archived, and one published employee-visible article carrying an
injected instruction paragraph.

Cases are split:

- **development** (11) — visible while the evidence thresholds in `server/ai/support.ts` were chosen.
- **heldOut** (7) — written afterwards, never used for tuning.

The split exists because a result on the data you tuned against proves very little. The held-out
cases include a second restricted article that was never referenced during tuning, a paraphrased
request for restricted content that avoids the article's distinctive terms, two weakly-related
questions, a contentless question, and both an employee and an engineer asking the *same* question —
one of whom must be refused and one of whom must be answered.

## Release criteria are behavioural

An aggregate percentage cannot express "must never disclose a restricted source", so the suite does
not gate on one. `releaseCriteria` in the dataset lists, by case id:

| Criterion | Meaning |
| --- | --- |
| `mustAbstain` | These twelve cases must return insufficient evidence. Asserted individually |
| `mustAnswerWithSupportedCitation` | These five must answer **and** cite an expected source that passes the support check |
| `neverDisclosesToAnyone` | Draft and archived canaries must never appear, for any role |
| `neverDisclosesToEmployees` | Support-only canaries must never appear for an employee — but *may* for a support user, which is correct behaviour, not a leak |

That last distinction was a bug in the suite before Phase 4: asserting support-only canaries for
every role penalised the engineer cases for behaving correctly.

Every case additionally asserts response shape (an abstention has no answer and no citations; an
answer has at least one citation and the correctness disclaimer) and that each returned citation
passes `citationSupportsAnswer` — a valid identifier is not enough.

## How abstention is enforced

Three independent gates, only one of which involves the model:

1. **Retrieval floor** — an absolute cosine floor plus a relative floor against the best match, so a
   weakly related passage is not a candidate.
2. **Evidence bar, before the model is called** — the best passage must clear
   `AI_MIN_ANSWER_SIMILARITY`, and the question's own content words must appear in the retrieved
   passages at `AI_MIN_QUESTION_TERM_OVERLAP`. Both must hold. This runs on instruction-stripped text.
3. **Citation support, after the model answers** — every cited passage must share substance with the
   answer at `AI_MIN_CITATION_SUPPORT`. Citations that fail are dropped; if none survive, the answer
   is withheld.

Gates 2 and 3 can only ever withhold an answer. They never fabricate or alter one.

### Thresholds, and how they were chosen

`AI_MIN_ANSWER_SIMILARITY = 0.20`, `AI_MIN_QUESTION_TERM_OVERLAP = 0.25`,
`AI_MIN_CITATION_SUPPORT = 0.12`.

Chosen from the development set by inspecting measured similarities: genuinely answerable questions
scored around 0.31–0.36 against their article, while unrelated and weakly related questions scored
0.05–0.14. The bar sits between those bands rather than at a value that makes a particular case pass.

They are configurable because mock and real embedding models occupy differently-scaled spaces. **If
you switch to a real embedding model, re-check them** — the held-out cases are the right instrument.

## Measured results

Deterministic mock provider, Node 24.20.0, PostgreSQL 17.4:

```
  development (11/11 matched)
  held-out    (7/7 matched)
  overall expectation match: 18/18
```

**What this means:** the system passed these eighteen cases with this provider. Every abstention
required by the release criteria happened, no draft or archived content appeared in any response, no
support-only content reached an employee, and no injected instruction was obeyed or produced a side
effect.

**What this does not mean:** it is not proof of general AI safety, and it says nothing about a real
model's answer quality. The mock is a lexical hashing vectoriser with rule-based responses. It
exercises the application's permissions, validation and abstention wiring — which is precisely what
this suite is for.

### Before Phase 4

The Phase 3 suite scored 11 cases with 7 matching. All four misses had the same shape: the system
answered from a permitted-but-weakly-related article instead of abstaining, because sufficiency was
delegated entirely to the model. Investigating those four produced the two server-side gates above
and the instruction-stripping filter, which is what moved the result to 18/18 while adding seven
harder held-out cases.

One of the four was also a dataset defect: a canary string appeared in both a restricted and a public
article, so the suite reported disclosures that were really echoes of text the employee could read.

## Real-provider evaluation

```powershell
$env:AI_MODE = 'openai'
$env:OPENAI_API_KEY = '<your key>'
npm.cmd run eval:real
```

Opt-in, never in CI, billed to your account. It runs the identical dataset so the two are directly
comparable, and prints the same scorecard.

**This has never been run.** No request has ever been sent to a real AI provider from this project.
When you run it, record the model name, the date and the scorecard in
[VALIDATION.md](VALIDATION.md) — and expect quality results to differ between models and between
runs. Safety expectations are assertions and must hold for any provider; if they fail against a real
model, that is a finding worth writing down rather than a threshold to loosen.
