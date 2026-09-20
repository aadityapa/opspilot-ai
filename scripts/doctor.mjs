/**
 * Environment doctor.
 *
 * Checks that a local setup is complete and consistent, and says exactly what to do about anything
 * that is not. It exists because the most common way to lose an hour on this project is to copy an
 * older `.env`, miss `TEST_DATABASE_URL`, and only find out when `npm test` fails somewhere
 * confusing.
 *
 *   npm.cmd run doctor
 *
 * It never prints a password, an API key, or a connection string. Values are described, not shown.
 */
import 'dotenv/config';
import pg from 'pg';

const required = [
  ['DATABASE_URL', 'the application database', true],
  ['APP_ORIGIN', 'the exact browser origin, used for CSRF and CORS', true],
  ['TEST_DATABASE_URL', 'a separate disposable database for `npm test`', true],
  ['E2E_DATABASE_URL', 'a separate disposable database for `npm run test:e2e`', true],
  ['NODE_ENV', 'development, test or production', false],
  ['PORT', 'the API port (default 3001)', false],
  ['MAIL_MODE', 'disabled or mailpit (default disabled)', false],
  ['AI_MODE', 'disabled, mock or openai (default disabled)', false],
];

let problems = 0;
let warnings = 0;
const fail = (message, fix) => {
  problems++;
  console.log(`  ✗ ${message}`);
  if (fix) console.log(`      → ${fix}`);
};
const warn = (message, fix) => {
  warnings++;
  console.log(`  ! ${message}`);
  if (fix) console.log(`      → ${fix}`);
};
const ok = (message) => console.log(`  ✓ ${message}`);

console.log('\nOpsPilot environment check\n');
console.log(`Runtime: Node ${process.version}`);
const major = Number(process.version.slice(1).split('.')[0]);
if (major !== 24) warn(`package.json declares Node 24; you are on ${process.version}.`, 'Install Node 24 LTS for the supported runtime.');
else ok('Node major version matches the declared runtime.');

console.log('\nEnvironment variables');
const urls = {};
for (const [key, purpose, isRequired] of required) {
  const value = process.env[key];
  if (!value) {
    if (isRequired) fail(`${key} is not set — ${purpose}.`, `Copy the entry from .env.example into your .env.`);
    else ok(`${key} not set; the documented default applies (${purpose}).`);
    continue;
  }
  if (key.endsWith('DATABASE_URL')) {
    try {
      const parsed = new URL(value);
      urls[key] = parsed;
      ok(`${key} → host ${parsed.hostname}, port ${parsed.port || '5432'}, database "${parsed.pathname.slice(1)}"`);
    } catch {
      fail(`${key} is not a valid URL.`, 'Expected postgresql://user:password@host:port/database');
    }
  } else if (key === 'APP_ORIGIN') {
    try {
      const parsed = new URL(value);
      if (parsed.origin !== value) fail('APP_ORIGIN must be a bare origin with no trailing path or slash.', 'For example http://localhost:5173');
      else ok(`APP_ORIGIN → ${value}`);
    } catch {
      fail('APP_ORIGIN is not a valid URL.', 'For example http://localhost:5173');
    }
  } else {
    ok(`${key} is set.`);
  }
}
if (process.env.OPENAI_API_KEY) {
  if (process.env.AI_MODE === 'openai') ok('OPENAI_API_KEY is set and AI_MODE is openai. (Value not shown.)');
  else fail('OPENAI_API_KEY is set but AI_MODE is not "openai".', 'Remove the key, or set AI_MODE=openai. Startup refuses this combination.');
} else if (process.env.AI_MODE === 'openai') {
  fail('AI_MODE=openai but OPENAI_API_KEY is not set.', 'Set the key, or use AI_MODE=mock, which needs no credentials.');
}

console.log('\nAccount security');
if (!process.env.APP_SECRET) warn('APP_SECRET is not set; authenticator secrets are encrypted with the fixed development value.', 'Run npm run setup to generate one. Production refuses to start without it.');
else if (process.env.APP_SECRET.length < 32) fail('APP_SECRET is shorter than 32 characters.', 'Generate a longer one; startup refuses this value.');
else ok('APP_SECRET is set. (Value not shown.)');
const mfaRoles = (process.env.MFA_REQUIRED_ROLES ?? '').split(',').map((r) => r.trim()).filter(Boolean);
const badRole = mfaRoles.find((r) => !['EMPLOYEE', 'ENGINEER', 'ADMIN'].includes(r));
if (badRole) fail(`MFA_REQUIRED_ROLES contains an unknown role: ${badRole}`, 'Use EMPLOYEE, ENGINEER and/or ADMIN.');
else ok(mfaRoles.length ? `Two-factor authentication is required for: ${mfaRoles.join(', ')}.` : 'Two-factor authentication is optional for every role (MFA_REQUIRED_ROLES is empty).');
ok(`Lockout: ${process.env.LOCKOUT_THRESHOLD || 5} failures → ${process.env.LOCKOUT_MINUTES || 15} minutes. Sessions last ${process.env.SESSION_HOURS || 8} hour(s).`);
if (process.env.METRICS_TOKEN) ok('METRICS_TOKEN is set; GET /metrics is enabled for the bearer of that token. (Value not shown.)');
else ok('METRICS_TOKEN is empty; /metrics is disabled.');

console.log('\nDatabase separation');
const distinct = new Set(
  Object.entries(urls).map(([, u]) => `${u.hostname}:${u.port || '5432'}${u.pathname}`),
);
if (Object.keys(urls).length === 3 && distinct.size === 3) ok('Application, test and browser-test databases are three distinct databases.');
else if (Object.keys(urls).length === 3) fail('Two or more of the database URLs point at the same database.', 'Tests delete and rewrite records. Give each its own database — see docs/SETUP.md.');

console.log('\nConnectivity and schema');
for (const [key, parsed] of Object.entries(urls)) {
  const name = parsed.pathname.slice(1);
  const client = new pg.Client({ connectionString: process.env[key], connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
  } catch (error) {
    const code = error instanceof Error ? error.code ?? '' : '';
    if (code === '3D000')
      fail(
        `${key}: database "${name}" does not exist.`,
        `Run: npm.cmd run setup — it creates all three. Or, with Docker: docker compose exec db createdb -U opspilot ${name}`,
      );
    else
      fail(
        `${key}: cannot connect to ${parsed.hostname}:${parsed.port || '5432'}.`,
        parsed.hostname === 'db'
          ? 'Host "db" only resolves inside a container. From Windows use localhost:5433.'
          : 'Start the database, then run this again. Either `npm.cmd run db:local` (no Docker needed) or `docker compose up -d db`.',
      );
    continue;
  }
  try {
    const version = await client.query('SELECT version() AS v');
    const applied = await client.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='_prisma_migrations') AS present`,
    );
    if (!applied.rows[0].present) {
      warn(`${key}: connected to "${name}", but no migrations have been applied.`, 'Run: npm.cmd run db:migrate');
    } else {
      const pending = await client.query(
        `SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NULL`,
      );
      const total = await client.query(`SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`);
      if (pending.rows[0].n > 0) warn(`${key}: ${pending.rows[0].n} migration(s) did not finish.`, 'Run: npm.cmd run db:migrate');
      else ok(`${key}: connected. ${total.rows[0].n} migration(s) applied. ${version.rows[0].v.split(',')[0]}.`);
    }
    if (key === 'DATABASE_URL' && applied.rows[0].present) {
      const counts = await client.query(
        `SELECT (SELECT count(*)::int FROM "User") AS users, (SELECT count(*)::int FROM "Ticket") AS tickets, (SELECT count(*)::int FROM "ArticleChunk") AS chunks`,
      );
      const { users, tickets, chunks } = counts.rows[0];
      ok(`Application data: ${users} user(s), ${tickets} ticket(s), ${chunks} indexed passage(s).`);
      if (users === 0) warn('No accounts exist yet.', 'Seed fictional demo accounts — see docs/SETUP.md.');
      if (chunks === 0 && process.env.AI_MODE && process.env.AI_MODE !== 'disabled')
        warn('AI is enabled but the retrieval index is empty.', 'Run: npm.cmd run ai:reindex');
    }
    const vector = await client.query(`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname='vector') AS present`);
    if (key === 'DATABASE_URL' && !vector.rows[0].present)
      ok('pgvector is not installed. Not required — ranking uses the exact SQL cosine function (docs/RETRIEVAL.md).');
  } finally {
    await client.end();
  }
}

console.log('\nWhere the database lives');
console.log('  From Windows (npm run dev, npm test):   localhost:5433');
console.log('  Inside the app container (compose):     db:5432         → the same database');
console.log('  Without Docker (npm run db:local):      127.0.0.1:5433  → data in .local-db/');
console.log('  Mailpit SMTP from Windows:              127.0.0.1:1025  · web UI http://localhost:8025');
console.log('  Mailpit SMTP inside the container:      mailpit:1025');

console.log(
  problems
    ? `\n${problems} problem(s) and ${warnings} warning(s). Fix the problems above, then run this again.\n`
    : `\nNo problems found${warnings ? `, ${warnings} warning(s)` : ''}. You are ready to run the application and the test suites.\n`,
);
process.exit(problems ? 1 : 0);
