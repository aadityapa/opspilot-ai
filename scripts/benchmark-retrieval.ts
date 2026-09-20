/**
 * Reproducible latency benchmark for exact cosine ranking.
 *
 * Why this exists: the project ranks retrieval candidates with an exact cosine-distance SQL
 * function rather than an approximate pgvector index. That is a performance claim, so it is
 * measured rather than asserted. Run it yourself and compare.
 *
 *   $env:BENCH_DATABASE_URL = 'postgresql://opspilot:...@localhost:5433/opspilot_bench'
 *   npm.cmd run bench:retrieval
 *
 * The benchmark refuses to run against a database that holds application data. It creates its own
 * fictional articles, measures, and removes only what it created.
 *
 * Important: DATABASE_URL is overridden before any server module is imported, because the
 * application's Prisma client reads it at module load. An earlier version of this script did not,
 * and silently measured a different database — which is exactly the kind of mistake a benchmark
 * has to be written to avoid.
 */
import 'dotenv/config';
import { performance } from 'node:perf_hooks';

const url = process.env.BENCH_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Set BENCH_DATABASE_URL (or TEST_DATABASE_URL) to a disposable database.');
if (!/_bench$|_test$/.test(new URL(url).pathname))
  throw new Error('BENCH_DATABASE_URL must name a disposable database ending in _bench or _test.');
process.env.DATABASE_URL = url;
process.env.AI_MODE = process.env.AI_MODE === 'disabled' ? 'mock' : (process.env.AI_MODE ?? 'mock');

const { db } = await import('../server/db.js');
const { MockProvider } = await import('../server/ai/provider.js');
const { chunkArticle, search } = await import('../server/ai/retrieval.js');

// Vector width matters more than row count for this workload, so it is configurable. The mock's
// natural width is 256; text-embedding-3-small produces 1536, which is what a real deployment
// would store. Measure the width you intend to run.
const provider = new MockProvider(Number(process.env.BENCH_DIMENSIONS ?? 256));
const TAG = 'BENCHMARK-FICTIONAL';

/** Refuses to touch a database that looks like a real workspace. */
async function assertDisposable() {
  const [tickets, assets, articles] = await Promise.all([
    db.ticket.count(),
    db.asset.count(),
    db.article.count({ where: { NOT: { title: { startsWith: TAG } } } }),
  ]);
  if (tickets || assets || articles)
    throw new Error(
      `Refusing to benchmark: this database holds ${tickets} ticket(s), ${assets} asset(s) and ${articles} non-benchmark article(s). Use an empty, disposable database.`,
    );
}

const SUBJECTS = ['the VPN client', 'the office printer', 'a wireless access point', 'the shared folder', 'a laptop battery', 'the core switch', 'the licence server', 'a desk phone'];
const PROBLEMS = ['disconnects intermittently', 'reports an authentication error', 'fails to appear on the network', 'shows a stale configuration', 'loses power unexpectedly', 'refuses new connections'];
const ACTIONS = ['restart the service and confirm the status', 'remove the stale profile and download a current one', 'check the cable at both ends', 'raise a ticket in the relevant category', 'record the exact error code shown', 'verify the assignment in the inventory'];

/** Fixed seed, so the corpus is identical on every run and on every machine. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

function corpus(articleCount: number) {
  const rand = seeded(20260909);
  const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];
  return Array.from({ length: articleCount }, (_, i) => ({
    title: `${TAG} article ${i + 1}: ${pick(SUBJECTS)} ${pick(PROBLEMS)}`,
    markdown: Array.from({ length: 4 }, (_, section) =>
      `## Section ${section + 1}\n\n` +
      Array.from({ length: 3 }, () => `When ${pick(SUBJECTS)} ${pick(PROBLEMS)}, ${pick(ACTIONS)}.`).join(' ') +
      `\n\nIf the problem persists, ${pick(ACTIONS)} and include the details in your ticket.`,
    ).join('\n\n'),
  }));
}

async function build(articleCount: number, categoryId: string, authorId: string) {
  await db.articleChunk.deleteMany({ where: { article: { title: { startsWith: TAG } } } });
  await db.article.deleteMany({ where: { title: { startsWith: TAG } } });
  let chunks = 0;
  for (const article of corpus(articleCount)) {
    const created = await db.article.create({
      data: {
        title: article.title, markdown: article.markdown, visibility: 'EMPLOYEE', status: 'PUBLISHED',
        categoryId, authorId, publishedAt: new Date(),
        indexedVersion: 0, indexedModel: provider.embeddingModel, indexedDimensions: provider.dimensions, indexedAt: new Date(),
      },
    });
    const pieces = chunkArticle(article.markdown);
    const vectors = await provider.embed(pieces.map((p) => `${article.title}\n${p.heading ?? ''}\n${p.content}`));
    await db.articleChunk.createMany({
      data: pieces.map((piece, index) => ({
        articleId: created.id, articleVersion: 0, chunkIndex: index,
        heading: piece.heading, content: piece.content,
        embedding: vectors.vectors[index], embeddingModel: vectors.model, dimensions: vectors.dimensions,
      })),
    });
    chunks += pieces.length;
  }
  return chunks;
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];

async function main() {
  await assertDisposable();
  const category = await db.category.upsert({
    where: { name: `${TAG} category` }, update: {}, create: { name: `${TAG} category` },
  });
  const author = await db.user.upsert({
    where: { email: 'benchmark@example.test' }, update: {},
    create: { email: 'benchmark@example.test', name: 'Benchmark author', role: 'ADMIN', passwordHash: 'not-a-usable-hash', isDemo: true },
  });

  const questions = [
    'the vpn client disconnects intermittently what should I do',
    'my printer will not appear on the network',
    'how do I get access to a shared folder',
    'the access point keeps losing power',
    'the core switch refuses new connections',
  ];
  const employee = { id: author.id, name: 'bench', role: 'EMPLOYEE' as const, email: 'benchmark@example.test' };

  const server = await db.$queryRaw<{ v: string }[]>`SELECT version() AS v`;
  console.log('\nExact cosine ranking — latency benchmark');
  console.log(`Node ${process.version} · ${provider.embeddingModel} · ${provider.dimensions} dimensions · top-k 5`);
  console.log(`${server[0].v.split(',')[0]}\n`);
  console.log('articles  chunks   queries   p50 ms   p95 ms   max ms   returned');

  // Sizes are configurable so a slow machine can still finish; the default spans a realistic
  // small-company knowledge base up to roughly ten times that size.
  const sizes = (process.env.BENCH_SIZES ?? '10,50,200,500').split(',').map((n) => Number(n.trim()));
  for (const articleCount of sizes) {
    const chunks = await build(articleCount, category.id, author.id);
    const embeddings = await Promise.all(questions.map((q) => provider.embed([q])));
    for (const e of embeddings) await search(employee, e.vectors[0], provider, 5); // warm-up
    const samples: number[] = [];
    let returned = 0;
    for (let round = 0; round < 6; round++)
      for (const e of embeddings) {
        const started = performance.now();
        const hits = await search(employee, e.vectors[0], provider, 5);
        samples.push(performance.now() - started);
        returned += hits.length;
      }
    samples.sort((a, b) => a - b);
    console.log(
      `${String(articleCount).padStart(8)}  ${String(chunks).padStart(6)}   ${String(samples.length).padStart(7)}   ` +
        `${percentile(samples, 0.5).toFixed(1).padStart(6)}   ${percentile(samples, 0.95).toFixed(1).padStart(6)}   ` +
        `${samples[samples.length - 1].toFixed(1).padStart(6)}   ${String(returned).padStart(8)}`,
    );
  }

  await db.articleChunk.deleteMany({ where: { article: { title: { startsWith: TAG } } } });
  await db.article.deleteMany({ where: { title: { startsWith: TAG } } });
  await db.category.deleteMany({ where: { name: `${TAG} category` } });
  await db.user.deleteMany({ where: { email: 'benchmark@example.test' } });
  console.log('\nFictional benchmark data removed.');
  console.log('Latency is per query, end to end through the same permission-filtered SQL the application');
  console.log('uses, including the round trip to PostgreSQL. "returned" is the total passages returned');
  console.log('across all queries — a zero there would mean the benchmark measured an empty result set.\n');
}

try {
  await main();
} finally {
  await db.$disconnect();
}
