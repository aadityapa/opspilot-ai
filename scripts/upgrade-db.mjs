/**
 * Brings a running database up to date before the application starts: applies pending migrations,
 * and — on a demo installation only — refreshes the fictional data and search index when a
 * migration was just applied, so new features arrive with the sample content they need.
 *
 * Used by `npm run dev:local` and `start.bat`. Safe to run any time: migrations are additive, the
 * seed is idempotent, and a database holding real (non-demo) accounts is never seeded.
 */
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const isWindows = process.platform === 'win32';
const run = (args, env = {}) => spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, ...env }, windowsHide: true });

export async function upgradeDatabase({ quiet = false } = {}) {
  const say = (m) => { if (!quiet) console.log(m); };
  // Preflight first: a missing database is refused rather than created, and connection problems
  // are named without repeating the URL.
  const preflight = run(['node_modules/tsx/dist/cli.mjs', 'server/preflight.ts']);
  if (preflight.status !== 0) {
    let reason = 'the database did not answer';
    try { reason = JSON.parse(preflight.stderr.trim().split('\n').pop()).reason; } catch { /* keep the generic reason */ }
    const error = new Error(`Cannot reach the database: ${reason}.`);
    error.code = 10;
    throw error;
  }
  const migrate = run(['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
  if (migrate.status !== 0) {
    const out = `${migrate.stdout}${migrate.stderr}`;
    // Prisma's connection errors: P1000 wrong credentials, P1001 nothing answering, P1003 database
    // missing, P1017 connection closed. Those are operational, not a migration problem.
    const connection = /P100[013]|P1017|Can't reach database server|Authentication failed|does not exist/.test(out);
    process.stderr.write(out.replace(/postgres(ql)?:\/\/[^\s"']+/gi, 'postgresql://…'));
    const error = new Error(connection ? 'The database did not answer or refused the connection. Check that it is running and that DATABASE_URL in .env is right.' : 'Applying migrations failed. Run `npm run db:migrate` to see the full message.');
    error.code = connection ? 10 : 11;
    throw error;
  }
  const applied = (migrate.stdout.match(/Applying migration/g) ?? []).length;
  if (applied) say(`Applied ${applied} new migration(s).`);
  if (!applied) return { applied, seeded: false };

  if (process.env.ALLOW_DEMO_SEED !== 'true' || !process.env.DEMO_PASSWORD) return { applied, seeded: false };
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  let realAccounts = 1;
  try {
    await client.connect();
    realAccounts = (await client.query('SELECT count(*)::int AS n FROM "User" WHERE "isDemo" = false')).rows[0].n;
  } finally {
    await client.end().catch(() => {});
  }
  if (realAccounts > 0) {
    say('Not re-seeding: this database holds non-demo accounts.');
    return { applied, seeded: false };
  }
  say('Refreshing the fictional demo data for the new features…');
  const seed = run(['node_modules/tsx/dist/cli.mjs', 'prisma/seed.ts']);
  if (seed.status !== 0) {
    process.stderr.write(seed.stdout + seed.stderr);
    say('Demo seed failed; the application will still start. Run `npm run db:seed` to retry.');
    return { applied, seeded: false };
  }
  const index = run(['node_modules/tsx/dist/cli.mjs', 'scripts/reindex.ts']);
  if (index.status !== 0) say('Search index rebuild failed; run `npm run ai:reindex` later.');
  return { applied, seeded: true };
}

if (process.argv[1] && new URL(import.meta.url).pathname.endsWith('upgrade-db.mjs') && process.argv[1].endsWith('upgrade-db.mjs')) {
  try {
    const result = await upgradeDatabase();
    console.log(result.applied ? `Database upgraded (${result.applied} migration(s)${result.seeded ? ', demo data refreshed' : ''}).` : 'Database already up to date.');
  } catch (error) {
    console.error(`\n  ✗ ${error.message}\n`);
    process.exit(error.code === 10 || error.code === 11 ? error.code : 1);
  }
}
