/**
 * One command to get OpsPilot running.
 *
 *   npm.cmd run setup
 *
 * It installs dependencies, finds a database, repairs `.env` without discarding anything you set,
 * applies migrations, loads fictional demo data, builds the retrieval index, and tells you what to
 * run next.
 *
 * Safe to run repeatedly. It backs `.env` up before writing, never removes a value you chose, never
 * prints a password or a key, and refuses to re-seed a database that holds real accounts.
 *
 * Database, in order of preference:
 *   1. whatever `DATABASE_URL` in your `.env` already points at, if something answers there
 *   2. Docker Compose, if Docker is installed and running
 *   3. any PostgreSQL already listening on a familiar loopback port
 *   4. a self-contained PostgreSQL downloaded on demand — no Docker, no admin rights
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';

const step = (n, title) => console.log(`\n${'─'.repeat(70)}\n  ${n}. ${title}\n${'─'.repeat(70)}`);
const ok = (m) => console.log(`  ✓ ${m}`);
const info = (m) => console.log(`    ${m}`);
const warn = (m) => console.log(`  ! ${m}`);
const fail = (m, hint) => {
  console.error(`\n  ✗ ${m}`);
  if (hint) console.error(`    ${hint}`);
  console.error('');
  process.exit(1);
};

const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? 'npm.cmd' : 'npm';
const npxCommand = isWindows ? 'npx.cmd' : 'npx';
const run = (cmd, args, env = {}) =>
  spawnSync(cmd, args, { stdio: 'inherit', shell: isWindows, env: { ...process.env, ...env } });
const capture = (cmd, args) =>
  spawnSync(cmd, args, { encoding: 'utf8', shell: isWindows, windowsHide: true });

console.log('\n  OpsPilot AI — setup');
console.log(`  Node ${process.version} on ${process.platform}\n`);

const nodeMajor = Number(process.version.slice(1).split('.')[0]);
if (nodeMajor < 24)
  fail(
    `This project needs Node 24; you are on ${process.version}.`,
    'Install Node 24 LTS from https://nodejs.org, close this terminal, open a new one, and run this again.',
  );

if (!existsSync('.env.example') || !existsSync('package.json'))
  fail('Run this from the project folder.', 'The folder that contains package.json and .env.example.');

/* ── 1. Dependencies ──────────────────────────────────────────────────── */
step(1, 'Dependencies');

if (!existsSync('node_modules')) {
  info('Installing packages — this takes a few minutes the first time.');
  const install = run(npmCommand, [existsSync('package-lock.json') ? 'ci' : 'install'], {});
  if (install.status !== 0)
    fail('Installing dependencies failed.', 'Check your internet connection and run `npm install` on its own to see the error.');
  ok('Dependencies installed');
} else {
  ok('Dependencies already installed');
}

// Safe to import now that node_modules exists.
const { default: pg } = await import('pg');

/* ── 2. Environment file ──────────────────────────────────────────────── */
step(2, 'Settings file (.env)');

const parseEnv = (text) =>
  Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]),
  );

const exampleText = readFileSync('.env.example', 'utf8');
const example = parseEnv(exampleText);
const existing = existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {};

if (existsSync('.env')) {
  copyFileSync('.env', '.env.backup');
  ok('Your existing .env was copied to .env.backup before any change');
} else {
  ok('No .env yet — creating one');
}

// Start from the example so nothing is missing, then restore every value you already chose.
const settings = { ...example };
const kept = [];
for (const [key, value] of Object.entries(existing)) {
  if (value !== '') {
    settings[key] = value;
    kept.push(key);
  }
}
const missing = Object.keys(example).filter((key) => !(key in existing));
if (kept.length) info(`Keeping the ${kept.length} value(s) you had set.`);
if (missing.length) ok(`Filling in ${missing.length} setting(s) that were missing`);

/* ── 3. Database ──────────────────────────────────────────────────────── */
step(3, 'Database');

const withDatabase = (url, name) => {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
};

async function serverAt(url, timeoutMs = 4000) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: timeoutMs });
  try {
    await client.connect();
    const result = await client.query('SELECT version() AS v');
    await client.end();
    return result.rows[0].v.split(' (')[0];
  } catch (error) {
    await client.end().catch(() => {});
    if (error?.code === '3D000') return 'PostgreSQL'; // reachable; that one database is absent
    return null;
  }
}

const portOpen = (host, port, timeoutMs = 800) =>
  new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const done = (answer) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });

let databaseUrl = null;
let usedEmbedded = false;
let mailpitRunning = false;

// (a) What .env already points at.
if (settings.DATABASE_URL) {
  const host = new URL(settings.DATABASE_URL).host;
  const version = await serverAt(withDatabase(settings.DATABASE_URL, 'postgres'));
  if (version) {
    databaseUrl = settings.DATABASE_URL;
    ok(`Using the database your .env already points at — ${host}`);
    info(version);
  } else if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(settings.DATABASE_URL).hostname)) {
    // A database on another machine is a deliberate choice. Quietly switching to a local one would
    // start the application against the wrong data; stop and say what is wrong instead.
    fail(
      `Nothing is answering at ${host}, which is what your .env points at.`,
      'That is not a local address, so setup will not substitute another database.\n    Check that the server is running, the host and port are right, and a firewall is not in the way.\n    To use a local database instead, change DATABASE_URL in .env and run setup again.',
    );
  } else {
    warn(`Nothing is answering at ${host}, which is what your .env points at.`);
    info('Looking for a database elsewhere…');
  }
}

// (b) Docker Compose — the documented path.
if (!databaseUrl && capture('docker', ['--version']).status === 0) {
  info('Docker is installed. Starting the database and mail containers…');
  const up = capture('docker', ['compose', 'up', '-d', 'db', 'mailpit']);
  if (up.status === 0) {
    const candidate = 'postgresql://opspilot:local-only-db-password@localhost:5433/opspilot';
    for (let attempt = 0; attempt < 30 && !databaseUrl; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      if (await serverAt(withDatabase(candidate, 'postgres'), 2000)) databaseUrl = candidate;
    }
    if (databaseUrl) ok('Docker containers are up — PostgreSQL on 5433, Mailpit on 8025');
    else warn('Docker started but the database never answered. Falling back.');
  } else {
    warn('Docker is installed but the containers would not start — is Docker Desktop running?');
    info((up.stderr || '').trim().split('\n')[0] || '');
  }
} else if (!databaseUrl) {
  info('Docker is not available here — that is fine, there are other options.');
}

// (c) Any PostgreSQL already listening somewhere familiar.
if (!databaseUrl) {
  const credentials = ['opspilot:local-only-db-password', 'postgres:postgres', 'postgres:postgres1', 'postgres:'];
  for (const port of [5433, 5432, 55439]) {
    if (databaseUrl) break;
    if (!(await portOpen('127.0.0.1', port))) continue;
    info(`Something is listening on port ${port}. Trying to sign in…`);
    for (const credential of credentials) {
      const candidate = `postgresql://${credential}@localhost:${port}/postgres`;
      const version = await serverAt(candidate, 3000);
      if (version) {
        databaseUrl = withDatabase(candidate, 'opspilot');
        ok(`Using the PostgreSQL already running on port ${port}`);
        info(version);
        break;
      }
    }
    if (!databaseUrl) warn(`Port ${port} is open but none of the usual passwords worked. Skipping it.`);
  }
}

// (d) Self-contained PostgreSQL. No Docker, no service install, no admin rights.
let embeddedServer = null;
if (!databaseUrl) {
  info('No database found, so setup will use a self-contained PostgreSQL instead.');
  info('It lives in .local-db/ inside this folder and needs no Docker and no admin rights.');
  try {
    const { startLocalDatabase, LOCAL_DB_URL } = await import('./local-db.mjs');
    embeddedServer = await startLocalDatabase({ quiet: true });
    databaseUrl = LOCAL_DB_URL('opspilot');
    usedEmbedded = true;
    ok('Self-contained PostgreSQL is running on 127.0.0.1:5433');
  } catch (error) {
    const detail = error?.message ?? String(error ?? 'no further detail was reported');
    fail(
      'Could not start a database.',
      `${detail}\n\n    Other ways forward: install Docker Desktop and run \`docker compose up -d db mailpit\`,\n    or install PostgreSQL yourself and put its connection string in DATABASE_URL.`,
    );
  }
}

/* ── 4. The three databases ───────────────────────────────────────────── */
step(4, 'One database for the app, two for the tests');

const admin = new pg.Client({
  connectionString: withDatabase(databaseUrl, 'postgres'),
  connectionTimeoutMillis: 10_000,
});
await admin.connect();
for (const name of ['opspilot', 'opspilot_test', 'opspilot_e2e_test']) {
  const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (found.rowCount) ok(`"${name}" is already there`);
  else {
    await admin.query(`CREATE DATABASE "${name}"`);
    ok(`Created "${name}"`);
  }
}
await admin.end();

settings.DATABASE_URL = withDatabase(databaseUrl, 'opspilot');
settings.TEST_DATABASE_URL = withDatabase(databaseUrl, 'opspilot_test');
settings.E2E_DATABASE_URL = withDatabase(databaseUrl, 'opspilot_e2e_test');
info(`All three live on ${new URL(databaseUrl).host}. The tests never touch your application data.`);

/* ── 5. Remaining settings ────────────────────────────────────────────── */

// A demo password of the length the seed guard requires, generated locally, never printed.
if (!settings.DEMO_PASSWORD || settings.DEMO_PASSWORD.length < 16)
  settings.DEMO_PASSWORD = randomBytes(16).toString('hex');
settings.ALLOW_DEMO_SEED = 'true';

// A per-install key for encrypting authenticator secrets. Generated once, then left alone: changing
// it would make every enrolled authenticator unreadable.
if (!settings.APP_SECRET || settings.APP_SECRET.length < 32) settings.APP_SECRET = randomBytes(48).toString('base64url');

// Mock AI needs no key and no network, so it is the sensible default for a first run.
if (!settings.AI_MODE || settings.AI_MODE === 'disabled') settings.AI_MODE = 'mock';

// Mailpit is only reachable when its container is up. Pointing at a sink that isn't there would
// make every notification retry and fail, so check before choosing.
mailpitRunning = await portOpen('127.0.0.1', 1025, 600);
if (settings.MAIL_MODE === 'mailpit' && !mailpitRunning) settings.MAIL_MODE = 'disabled';

// Write the file, keeping the example's comments and ordering so it stays readable.
let output = exampleText;
for (const [key, value] of Object.entries(settings)) {
  const line = new RegExp(`^${key}=.*$`, 'm');
  if (line.test(output)) output = output.replace(line, `${key}=${value}`);
  else output += `\n${key}=${value}`;
}
writeFileSync('.env', output.endsWith('\n') ? output : `${output}\n`);
ok('.env saved');
info(`AI mode: ${settings.AI_MODE}${settings.AI_MODE === 'mock' ? ' (offline stand-in, no key needed)' : ''}`);
info(
  mailpitRunning
    ? 'Email: captured by Mailpit at http://localhost:8025'
    : 'Email: queued in the outbox but not delivered (no Mailpit running) — nothing leaves your machine',
);

/* ── 6. Schema, data and index ────────────────────────────────────────── */
step(5, 'Database schema, demo data and search index');

const env = { DATABASE_URL: settings.DATABASE_URL };
const stopEmbedded = async () => {
  if (embeddedServer) await embeddedServer.stop().catch(() => {});
};

if (run(npxCommand, ['prisma', 'generate'], env).status !== 0) {
  await stopEmbedded();
  fail('Generating the database client failed.');
}
ok('Database client generated');

if (run(npxCommand, ['prisma', 'migrate', 'deploy'], env).status !== 0) {
  await stopEmbedded();
  fail('Applying migrations failed.', 'The message above says which migration stopped.');
}
ok('Schema applied');

const appDb = new pg.Client({ connectionString: settings.DATABASE_URL });
await appDb.connect();
const counts = await appDb.query(
  'SELECT count(*)::int AS total, count(*) FILTER (WHERE "isDemo" = false)::int AS real FROM "User"',
);
const { total, real } = counts.rows[0];
await appDb.end();

let seeded = true;
if (real > 0) {
  seeded = false;
  warn(`This database holds ${real} account(s) that are not demo accounts, so it will not be re-seeded.`);
  info('Nothing of yours was changed.');
} else {
  if (total > 0) info(`${total} demo account(s) already present — refreshing them.`);
  const seed = run(npxCommand, ['tsx', 'prisma/seed.ts'], {
    ...env,
    ALLOW_DEMO_SEED: 'true',
    DEMO_PASSWORD: settings.DEMO_PASSWORD,
    NODE_ENV: 'development',
  });
  if (seed.status !== 0) {
    seeded = false;
    warn('Loading the demo data failed. The app will run, but it will be empty.');
  } else ok('Fictional demo data loaded');
}

if (seeded) {
  const index = run(npxCommand, ['tsx', 'scripts/reindex.ts'], { ...env, AI_MODE: settings.AI_MODE });
  if (index.status !== 0) warn(`Search index not built. Run \`${npmCommand} run ai:reindex\` later; Ask AI will abstain until then.`);
  else ok('Knowledge search index built');
}

await stopEmbedded();

/* ── 7. What to do next ───────────────────────────────────────────────── */
step(6, 'Ready');

console.log(`
  Start it with:

      ${npmCommand} run ${usedEmbedded ? 'dev:local' : 'dev'}
${usedEmbedded ? '\n  (that runs the self-contained database and the application together)\n' : ''}
  Then open   http://localhost:5173

  Sign in as any of these fictional people — same password for all four:

      employee@opspilot.example    Maya Chen       employee
      employee2@opspilot.example   Noah Williams   employee
      engineer@opspilot.example    Alex Morgan     IT engineer
      admin@opspilot.example       Jordan Patel    administrator

  The password is the DEMO_PASSWORD line in your .env file. Open .env to read it — it is
  deliberately not printed here so it stays out of your terminal history.

  Two things that trip people up:
    · Browse localhost, not 127.0.0.1. Sign-in checks the address exactly.
    · Leave the terminal running. Closing it stops the app.

  Also useful:
      ${npmCommand} run doctor    check this setup at any time
      ${npmCommand} test          run the API and unit suites
`);
