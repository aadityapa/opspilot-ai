/**
 * Resets the (disposable) browser-test database to empty before each run, so every run seeds the
 * same fictional story and nothing accumulates between runs: no leftover accounts, tickets,
 * articles or unread notifications from earlier suites, and no order-dependence between tests.
 *
 * Every application table is truncated in one statement (foreign keys handled by CASCADE); the
 * migration history and the SLA policy defaults are kept, so the schema stays applied. Run only by scripts/e2e.mjs, only
 * against a database whose name ends in `_e2e_test`.
 */
import { db } from '../server/db.js';
import { config } from '../server/config.js';
if (!new URL(config.DATABASE_URL).pathname.endsWith('_e2e_test')) throw new Error('Refusing to reset a database that is not the e2e database');
// SlaPolicy is reference configuration written by a migration (the four default targets), not
// data; it stays, and the seed leaves it alone as the application would.
const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'SlaPolicy')`;
if (tables.length) await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
// The four default targets from the SLA migration, restored in case an earlier reset removed them.
for (const [priority, responseMinutes, resolutionMinutes] of [['LOW', 480, 4320], ['MEDIUM', 240, 1440], ['HIGH', 60, 480], ['URGENT', 15, 120]] as const)
  await db.slaPolicy.upsert({ where: { priority }, update: {}, create: { priority, responseMinutes, resolutionMinutes } });
console.log(`e2e reset: ${tables.length} table(s) emptied; the seed will rebuild the demo story.`);
await db.$disconnect();
