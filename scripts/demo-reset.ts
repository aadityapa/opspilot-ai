/**
 * Puts the demo workspace back to exactly the seeded story: every application table is emptied and
 * the fictional organisation is seeded again, then the search index is rebuilt.
 *
 *   npm run demo:reset
 *
 * Guards, all of which must hold or nothing happens: NODE_ENV is not production, ALLOW_DEMO_SEED is
 * "true", DEMO_PASSWORD is set, the database host is local, and the database holds no account that
 * is not a demo account. It can therefore never touch a real installation.
 */
import { spawnSync } from 'node:child_process';
import { db } from '../server/db.js';
import { config } from '../server/config.js';
import { demoResetRefusal, nonDemoAccountRefusal } from './demo-guard.js';

const refuse = (why: string) => { console.error(`\n  ✗ ${why}\n`); process.exit(1); };
const configProblem = demoResetRefusal({ nodeEnv: config.NODE_ENV, allowDemoSeed: config.ALLOW_DEMO_SEED, demoPassword: process.env.DEMO_PASSWORD, databaseUrl: config.DATABASE_URL });
if (configProblem) refuse(configProblem);
const populated = nonDemoAccountRefusal(await db.user.count({ where: { isDemo: false } }));
if (populated) refuse(populated);

const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'SlaPolicy')`;
if (tables.length) await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
for (const [priority, responseMinutes, resolutionMinutes] of [['LOW', 480, 4320], ['MEDIUM', 240, 1440], ['HIGH', 60, 480], ['URGENT', 15, 120]] as const)
  await db.slaPolicy.upsert({ where: { priority }, update: {}, create: { priority, responseMinutes, resolutionMinutes } });
await db.$disconnect();
console.log(`Emptied ${tables.length} table(s). Seeding the demo story…`);
for (const script of ['prisma/seed.ts', 'scripts/reindex.ts']) {
  const r = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', script], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
console.log('Demo workspace reset. Sign in with the four demo accounts and the DEMO_PASSWORD from .env.');
