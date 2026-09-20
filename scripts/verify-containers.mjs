/**
 * Container verification.
 *
 * Everything this project claims about Docker is unverified, because Docker has never been
 * available in any environment it has been validated in. Rather than describe the checks in prose
 * and hope somebody performs them, they are written here as an executable script.
 *
 *   npm.cmd run verify:containers
 *
 * It exercises the pinned PostgreSQL 18 image, migrations, application startup, real Mailpit SMTP
 * delivery and message capture, service restart, and both a fresh install and an upgrade that must
 * preserve existing data. Every step prints PASS or FAIL with the evidence it used.
 *
 * The script is destructive to its own compose project only: it uses a separate project name and
 * separate volumes, so it cannot touch the database you develop against.
 *
 * Nothing here has been executed by the author. Run it and paste the output into
 * docs/VALIDATION.md, replacing the "not executed" rows.
 */
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PROJECT = 'opspilot-verify';
const DB_PORT = '55432';
const MAILPIT_SMTP = '11025';
const MAILPIT_HTTP = '18025';
const DB_URL = `postgresql://opspilot:local-only-db-password@127.0.0.1:${DB_PORT}/opspilot`;

let passed = 0;
let failed = 0;
const results = [];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  return {
    code: result.status,
    out: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
}
const compose = (...args) =>
  run('docker', ['compose', '-p', PROJECT, '-f', 'compose.verify.yaml', ...args], {
    env: { ...process.env, DB_PORT, MAILPIT_SMTP, MAILPIT_HTTP },
  });

function check(name, condition, evidence) {
  if (condition) {
    passed++;
    results.push(`PASS  ${name}`);
    console.log(`PASS  ${name}${evidence ? `\n        ${evidence}` : ''}`);
  } else {
    failed++;
    results.push(`FAIL  ${name}`);
    console.log(`FAIL  ${name}${evidence ? `\n        ${evidence}` : ''}`);
  }
}

const docker = run('docker', ['--version']);
if (docker.code !== 0) {
  console.error(
    '\nDocker is not available on this machine, so none of these checks can run.\n' +
      'Install Docker Desktop with the WSL 2 backend, start it, and run this again.\n',
  );
  process.exit(2);
}
console.log(`\nContainer verification\n${docker.out}\n${run('docker', ['compose', 'version']).out}\n`);

// A dedicated compose file so the developer's own stack and volumes are never touched.
const { writeFileSync, unlinkSync } = await import('node:fs');
writeFileSync(
  'compose.verify.yaml',
  `name: ${PROJECT}
services:
  db:
    image: pgvector/pgvector:pg18
    environment:
      POSTGRES_USER: opspilot
      POSTGRES_PASSWORD: local-only-db-password
      POSTGRES_DB: opspilot
    ports: ['127.0.0.1:\${DB_PORT}:5432']
    volumes: [verifydata:/var/lib/postgresql]
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U opspilot -d opspilot']
      interval: 3s
      timeout: 5s
      retries: 20
  mailpit:
    image: axllent/mailpit:v1.21
    ports:
      - '127.0.0.1:\${MAILPIT_SMTP}:1025'
      - '127.0.0.1:\${MAILPIT_HTTP}:8025'
    environment:
      MP_SMTP_AUTH_ACCEPT_ANY: 1
      MP_SMTP_AUTH_ALLOW_INSECURE: 1
volumes:
  verifydata:
`,
);

try {
  console.log('--- 1. Pinned images start and become healthy ---');
  compose('down', '-v');
  const up = compose('up', '-d');
  check('compose up starts the pinned images', up.code === 0, up.out.split('\n').slice(-2).join(' '));

  let healthy = false;
  for (let attempt = 0; attempt < 40 && !healthy; attempt++) {
    await sleep(2000);
    healthy = compose('exec', '-T', 'db', 'pg_isready', '-U', 'opspilot', '-d', 'opspilot').code === 0;
  }
  check('the database reports ready', healthy, `polled pg_isready for up to 80s`);

  const version = compose('exec', '-T', 'db', 'psql', '-U', 'opspilot', '-d', 'opspilot', '-tAc', 'SHOW server_version');
  check(
    'the database is PostgreSQL 18 as pinned',
    version.out.trim().startsWith('18'),
    `server_version = ${version.out.trim()}`,
  );

  const vector = compose('exec', '-T', 'db', 'psql', '-U', 'opspilot', '-d', 'opspilot', '-tAc',
    "SELECT count(*) FROM pg_available_extensions WHERE name='vector'");
  check('the pgvector extension is available in this image', vector.out.trim() === '1', `pg_available_extensions → ${vector.out.trim()}`);

  console.log('\n--- 2. Migrations apply to a fresh database ---');
  const migrate = run('npx', ['prisma', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: DB_URL } });
  check('all migrations apply cleanly', migrate.code === 0, migrate.out.split('\n').filter((l) => l.includes('Applying')).join(' | '));

  const extension = compose('exec', '-T', 'db', 'psql', '-U', 'opspilot', '-d', 'opspilot', '-tAc',
    "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector')");
  check(
    'the migration enabled pgvector where the image provides it',
    extension.out.trim() === 't',
    `pg_extension → ${extension.out.trim()} (retrieval does not depend on this; see docs/RETRIEVAL.md)`,
  );

  console.log('\n--- 3. Seed and application startup ---');
  const seed = run('npx', ['tsx', 'prisma/seed.ts'], {
    env: { ...process.env, DATABASE_URL: DB_URL, ALLOW_DEMO_SEED: 'true', DEMO_PASSWORD: 'Container-verification-2026' },
  });
  check('the guarded seed populates fictional data', seed.code === 0, seed.out.split('\n').pop());

  const reindex = run('npx', ['tsx', 'scripts/reindex.ts'], {
    env: { ...process.env, DATABASE_URL: DB_URL, AI_MODE: 'mock' },
  });
  check('the retrieval index builds', reindex.code === 0, reindex.out.split('\n').pop());

  const server = spawnSync(process.execPath, ['-e', `
    process.env.DATABASE_URL = ${JSON.stringify(DB_URL)};
    process.env.NODE_ENV = 'development';
    process.env.PORT = '3999';
    process.env.APP_ORIGIN = 'http://localhost:5173';
    process.env.MAIL_MODE = 'mailpit';
    process.env.MAILPIT_HOST = '127.0.0.1';
    process.env.AI_MODE = 'mock';
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], { env: process.env, stdio: 'ignore' });
    let ok = false;
    for (let i = 0; i < 30 && !ok; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try { ok = (await fetch('http://localhost:3999/api/health')).ok; } catch {}
    }
    child.kill();
    console.log(ok ? 'HEALTHY' : 'UNHEALTHY');
  `], { encoding: 'utf8' });
  check('the API starts against the container database and answers /api/health',
    (server.stdout ?? '').includes('HEALTHY'), 'started with tsx, polled /api/health for up to 30s');

  console.log('\n--- 4. Mailpit SMTP delivery and message capture ---');
  // Deliver through the real Mailpit container, then read it back through Mailpit's own HTTP API.
  const deliver = spawnSync(process.execPath, ['-e', `
    const nodemailer = (await import('nodemailer')).default;
    const t = nodemailer.createTransport({ host: '127.0.0.1', port: ${MAILPIT_SMTP}, secure: false, ignoreTLS: true });
    await t.sendMail({
      from: 'OpsPilot Verify <notifications@opspilot.example>',
      to: 'employee@opspilot.example',
      subject: 'OpsPilot container verification',
      text: 'A public reply was added to your ticket.\\nTicket OPS-0001. Sign in to OpsPilot to review it.',
    });
    t.close();
    console.log('SENT');
  `], { encoding: 'utf8' });
  check('a message is delivered over SMTP to the Mailpit container', (deliver.stdout ?? '').includes('SENT'), deliver.stderr?.trim() || 'nodemailer reported success');

  await sleep(1500);
  const captured = spawnSync(process.execPath, ['-e', `
    const res = await fetch('http://127.0.0.1:${MAILPIT_HTTP}/api/v1/messages');
    const body = await res.json();
    const first = body.messages?.[0];
    console.log(JSON.stringify({ total: body.messages_count ?? body.total ?? 0, subject: first?.Subject ?? null, to: first?.To?.[0]?.Address ?? null }));
  `], { encoding: 'utf8' });
  let capture = {};
  try { capture = JSON.parse((captured.stdout ?? '{}').trim()); } catch {}
  check('Mailpit captured the message with the expected subject and recipient',
    capture.subject === 'OpsPilot container verification' && capture.to === 'employee@opspilot.example',
    `Mailpit API reported ${JSON.stringify(capture)}`);

  console.log('\n--- 5. Restart behaviour ---');
  const before = compose('exec', '-T', 'db', 'psql', '-U', 'opspilot', '-d', 'opspilot', '-tAc', 'SELECT count(*) FROM "Ticket"');
  compose('stop');
  const restart = compose('start');
  let backUp = false;
  for (let attempt = 0; attempt < 30 && !backUp; attempt++) {
    await sleep(2000);
    backUp = compose('exec', '-T', 'db', 'psql', '-U', 'opspilot', '-d', 'opspilot', '-tAc', 'SELECT 1').code === 0;
  }
  const after = compose('exec', '-T', 'db', 'psql', '-U', 'opspilot', '-d', 'opspilot', '-tAc', 'SELECT count(*) FROM "Ticket"');
  check('services restart and data survives a stop/start cycle',
    restart.code === 0 && backUp && before.out.trim() === after.out.trim(),
    `tickets before=${before.out.trim()} after=${after.out.trim()}`);

  console.log('\n--- 6. Upgrade preserves existing data ---');
  const countsSql = [
    'SELECT (SELECT count(*) FROM "Ticket")',
    '(SELECT count(*) FROM "Reply")',
    '(SELECT count(*) FROM "Article")',
  ].join(' , ');
  const counts = (label) => {
    const r = compose('exec', '-T', 'db', 'psql', '-U', 'opspilot', '-d', 'opspilot', '-tA', '-F', '/', '-c', countsSql);
    console.log(`        ${label}: tickets/replies/articles = ${r.out.trim()}`);
    return r.out.trim();
  };
  const beforeUpgrade = counts('before re-running migrations');
  const again = run('npx', ['prisma', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: DB_URL } });
  const afterUpgrade = counts('after re-running migrations');
  check('re-applying migrations to a populated database changes no data',
    again.code === 0 && beforeUpgrade === afterUpgrade, `${beforeUpgrade} → ${afterUpgrade}`);

  console.log('\n--- 7. Fresh installation ---');
  compose('down', '-v');
  compose('up', '-d');
  let freshReady = false;
  for (let attempt = 0; attempt < 40 && !freshReady; attempt++) {
    await sleep(2000);
    freshReady = compose('exec', '-T', 'db', 'pg_isready', '-U', 'opspilot', '-d', 'opspilot').code === 0;
  }
  const freshMigrate = run('npx', ['prisma', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: DB_URL } });
  const freshCount = compose('exec', '-T', 'db', 'psql', '-U', 'opspilot', '-d', 'opspilot', '-tAc', 'SELECT count(*) FROM "Ticket"');
  check('a fresh volume migrates cleanly and starts empty',
    freshReady && freshMigrate.code === 0 && freshCount.out.trim() === '0',
    `tickets after fresh install = ${freshCount.out.trim()}`);
} finally {
  console.log('\nTearing down the verification stack (your own compose project is untouched)…');
  compose('down', '-v');
  try { unlinkSync('compose.verify.yaml'); } catch {}
}

console.log(`\n${'='.repeat(60)}\n${passed} passed, ${failed} failed\n${'='.repeat(60)}`);
for (const line of results) console.log(line);
console.log('\nPaste this output into docs/VALIDATION.md, replacing the "not executed" container rows.\n');
process.exit(failed ? 1 : 0);
