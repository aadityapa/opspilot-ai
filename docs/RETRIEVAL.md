# Knowledge retrieval: how it works, and what it costs

This document exists because Phase 3 made two claims about retrieval that were not backed by
evidence. Both are corrected here, with measurements.

## What is actually implemented

**Storage.** Published articles are split into passages that follow Markdown headings. Each passage
is stored in `ArticleChunk` with its text, the article version it came from, the embedding model and
vector width used, and the embedding itself in an `embedding DOUBLE PRECISION[]` column.

**Ranking.** One SQL statement joins `ArticleChunk` to `Article`, applies every permission and
freshness condition in the `WHERE`, computes an exact cosine distance per surviving candidate, orders
by it and takes the top *k*. There is no approximate index and no vector extension in the query path.

**Permission filtering happens inside that statement, before ranking and before the limit.** The
conditions are:

| Condition | Effect |
| --- | --- |
| `a.status = 'PUBLISHED'` | Drafts and archived articles are never candidates, for any role |
| `a.visibility = 'EMPLOYEE'` when the caller is an employee | Support-only runbooks are never candidates for employees |
| `c."embeddingModel" = …` and `c.dimensions = …` | Passages embedded by another model are not comparable and are excluded |
| `c."articleVersion" = a.version` | A passage describing superseded text is excluded even if a reindex has not run yet |

Because these are join and filter predicates rather than a post-filter on generated text, a passage
the caller may not read is never selected, never embedded into a prompt, and cannot be leaked by the
model. After the model answers, every citation is re-checked against current rows — see
[SECURITY.md](SECURITY.md).

## Correction: pgvector is enabled, but the schema is not index-ready

Phase 3 stated that an approximate pgvector index "can be introduced without another schema
migration". **That was wrong**, and the schema confirms it:

```
ArticleChunk.embedding   data_type = ARRAY   udt_name = _float8
```

pgvector's HNSW and IVFFlat index types operate on a column of type `vector`. A
`double precision[]` column cannot carry one. The migration enables the extension when the server
provides it, which is useful — creating an extension can need elevated privileges on a managed
database, so doing it early keeps a later migration simple — but it does not make this table
indexable.

**Adopting pgvector would require a migration that:**

1. Adds a typed column, e.g. `ALTER TABLE "ArticleChunk" ADD COLUMN embedding_v vector(1536);`
   The width must be fixed at column definition time, so a single column cannot serve two embedding
   models of different widths. Either pin one width, or add one column per supported width.
2. Backfills it from the existing array column, e.g.
   `UPDATE "ArticleChunk" SET embedding_v = embedding::text::vector;`
   (There is no direct `double precision[] → vector` cast; the text round-trip is the documented
   route. On a large table this wants batching.)
3. Creates the index, e.g.
   `CREATE INDEX ON "ArticleChunk" USING hnsw (embedding_v vector_cosine_ops);`
4. Changes the ranking query to `ORDER BY c.embedding_v <=> $1::vector` and drops the exact function
   from the hot path.
5. Adds a `NOT NULL` guard or a write path that keeps both columns in step, since the application
   writes the array column today.

It also changes behaviour, not just speed: an approximate index returns approximate neighbours. With
a permission filter this strict, an ANN index can also under-return, because it searches the vector
space first and filters afterwards — which is precisely the ordering this project avoids on purpose.
That trade-off deserves its own design pass, not a drive-by index.

**None of the above is implemented.** pgvector has never been installed in any environment this
project has been validated in, so no pgvector code path has ever executed here.

## Measured latency

Reproduce with:

```powershell
docker compose exec db createdb -U opspilot opspilot_bench
$env:BENCH_DATABASE_URL = 'postgresql://opspilot:local-only-db-password@localhost:5433/opspilot_bench'
npx.cmd prisma migrate deploy
npm.cmd run bench:retrieval
```

The benchmark builds a fictional corpus from a fixed seed, so the dataset is identical on every run
and every machine. It refuses to run against a database containing tickets, assets or non-benchmark
articles, and removes what it created. `BENCH_SIZES` and `BENCH_DIMENSIONS` are configurable.

**Environment:** Node 24.20.0, PostgreSQL 17.4 on x86-64 Linux, single container, no tuning. Per-query
latency measured end to end through the application's own `search()`, including the round trip to
PostgreSQL. Four passages per article. 30 queries per row, 5 distinct questions.

### Before and after the Phase 4 optimisation, at 256 dimensions

The Phase 3 function computed three correlated subqueries over the arrays, each re-scanning with
`generate_subscripts`, and the query called that function twice per row — once in the `WHERE`, once
in the `SELECT`. Migration `202609091006_retrieval_performance` replaces the function with a single
`unnest … WITH ORDINALITY` join that accumulates all three sums in one pass, and the query now
computes the distance once per row in a `LATERAL`.

| Articles | Passages | p50 before | p50 after | Improvement |
| --- | --- | --- | --- | --- |
| 10 | 40 | 82.6 ms | **6.1 ms** | 13.5× |
| 50 | 200 | 411.2 ms | **27.3 ms** | 15.1× |
| 200 | 800 | 1,666.5 ms | **122.6 ms** | 13.6× |

Results are numerically identical; only the cost changed. No table, column or row was touched, so the
migration applies to a populated database with no reindex.

### After optimisation, at both widths

| Articles | Passages | p50 @ 256 dim | p50 @ 1536 dim |
| --- | --- | --- | --- |
| 10 | 40 | 6.1 ms | 30.3 ms |
| 50 | 200 | 27.3 ms | 147.9 ms |
| 200 | 800 | 122.6 ms | 609.1 ms |
| 500 | 2,000 | 317.7 ms | 1,467.5 ms |
| 1,000 | 4,000 | 728.7 ms | — |

1536 is the width `text-embedding-3-small` produces, so **the right-hand column is the one that
matters for a real deployment.** The mock's 256 is convenient for tests, not representative of cost.

## What the numbers mean

Cost is linear in passages × dimensions, exactly as an exhaustive scan should be. Reading the 1536
column:

- **Up to ~50 articles (~200 passages): ~150 ms.** Comfortable. Exact ranking is the right choice.
- **Around 100–200 articles: 300–600 ms.** Noticeable but usable for a question-answering feature
  where the model call that follows costs more than the search.
- **Beyond ~500 articles: over 1.5 s.** Too slow. This is where the pgvector migration above earns
  its complexity.

The seeded demo has 7 articles. A small company's real knowledge base is plausibly 50–200. **Exact
ranking is appropriate for the stated target, and the crossover point is documented rather than
guessed** — which is the whole reason for measuring instead of adding an index for its own sake.

## Why exact ranking was kept

- It returns the true nearest passages. An approximate index returns approximate ones, and with a
  hard permission filter it can also under-return.
- There is no index to rebuild, so the fail-closed invalidation on article edit stays simple: delete
  the passages, and nothing stale can be served.
- It runs on a stock PostgreSQL server with no extension, which keeps the "clone it and run it"
  setup this project is built around.
- At the target scale it is fast enough, now that it has been measured and fixed.

The honest summary: exact ranking was chosen because it fits this project's size and safety model,
and it is documented with a measured limit rather than presented as universally sufficient.
