/**
 * Explicitly claims the test and browser-test databases as disposable.
 *
 * The automatic guard in guard-database.mjs claims a database only when it is empty or holds
 * nothing but fictional demo data. That is deliberately conservative, and it cannot tell "records a
 * previous test run created" from "records somebody cares about" — some browser tests create
 * ordinary, non-demo accounts, which is exactly what a real workspace looks like.
 *
 * So the ambiguous case is resolved by a person, once. This command shows what each database
 * contains and requires --confirm before writing the marker.
 *
 *   npm.cmd run db:claim-test              # show what is there, change nothing
 *   npm.cmd run db:claim-test -- --confirm # claim them
 */
import 'dotenv/config';
import pg from 'pg';

const confirm = process.argv.includes('--confirm');
const targets = [
  ['TEST_DATABASE_URL', 'the API/unit test suite'],
  ['E2E_DATABASE_URL', 'the browser test suite'],
];

console.log(confirm ? '\nClaiming disposable databases\n' : '\nInspecting candidate test databases (nothing will be changed)\n');

let claimed = 0;
for (const [key, purpose] of targets) {
  const url = process.env[key];
  if (!url) {
    console.log(`  ${key} is not set — skipping. Copy it from .env.example.`);
    continue;
  }
  const name = new URL(url).pathname.slice(1);
  if (url === process.env.DATABASE_URL) {
    console.log(`  ✗ ${key} points at the same database as DATABASE_URL. Refusing. Use a separate database.`);
    continue;
  }
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
  } catch {
    console.log(`  ✗ ${key}: cannot connect to "${name}". Is the database running?`);
    continue;
  }
  try {
    const tables = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)`,
      [['User', 'Ticket', 'Asset', 'Article', 'Reply']],
    );
    const summary = [];
    for (const { table_name: table } of tables.rows) {
      const count = await client.query(`SELECT count(*)::int AS n FROM "${table}"`);
      summary.push(`${table}=${count.rows[0].n}`);
    }
    console.log(`  ${key} → "${name}" (${purpose})`);
    console.log(`      contents: ${summary.join(', ') || 'no application tables yet'}`);
    if (!confirm) {
      console.log('      would be claimed as disposable. Re-run with -- --confirm to proceed.');
      continue;
    }
    // Same dedicated schema the automatic guard uses, so Prisma never sees it in `public`.
    await client.query('CREATE SCHEMA IF NOT EXISTS "opspilot_guard"');
    await client.query(
      `CREATE TABLE IF NOT EXISTS "opspilot_guard"."disposable" (
         purpose TEXT PRIMARY KEY, claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(), note TEXT NOT NULL)`,
    );
    await client.query(
      `INSERT INTO "opspilot_guard"."disposable" (purpose, note) VALUES ($1, $2) ON CONFLICT (purpose) DO NOTHING`,
      [purpose, 'Claimed explicitly with npm run db:claim-test. DROP SCHEMA "opspilot_guard" CASCADE to unclaim.'],
    );
    claimed++;
    console.log('      ✓ claimed. Test suites may now delete and rewrite records here.');
  } finally {
    await client.end();
  }
}

console.log(
  confirm
    ? `\n${claimed} database(s) claimed. Run npm.cmd test and npm.cmd run test:e2e.\n`
    : '\nNothing was changed. Re-run with -- --confirm once you are sure these are disposable.\n',
);
