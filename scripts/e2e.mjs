import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { assertDisposableDatabase } from './guard-database.mjs';

const url = process.env.E2E_DATABASE_URL;
// Same two-part guard as the API suite: naming convention plus inspection of the database itself.
const guard = await assertDisposableDatabase(url, {
  purpose: 'the browser test suite',
  expectedSuffix: '_e2e_test',
  appUrl: process.env.DATABASE_URL,
});
if (guard.decision !== 'already-marked')
  console.log(`Claimed "${guard.name}" as a disposable browser-test database.`);
const env = {
  ...process.env,
  DATABASE_URL: url,
  NODE_ENV: 'test',
  ALLOW_DEMO_SEED: 'true',
  DEMO_PASSWORD: 'Synthetic-E2E-password-2026',
  PORT: '3002',
  WEB_PORT: '5174',
  APP_ORIGIN: 'http://localhost:5174',
  // Browser tests run against the deterministic mock provider: no credentials, no network calls,
  // and the same answer every run. A real key is never needed to run or to review this suite.
  AI_MODE: 'mock',
  OPENAI_API_KEY: undefined,
  MAIL_MODE: 'disabled',
  // The browser suite signs in many times from one address. The limiter is still active, just
  // raised for this loopback-only run; the production default is unchanged.
  LOGIN_RATE_LIMIT: '500',
};
delete env.OPENAI_API_KEY;
for (const args of [
  ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  // Empty the disposable database first, so every run starts from exactly the seeded story.
  ['node_modules/tsx/dist/cli.mjs', 'scripts/e2e-reset.ts'],
  ['node_modules/tsx/dist/cli.mjs', 'prisma/seed.ts'],
  // Build the retrieval index so the knowledge-answer tests have passages to cite.
  ['node_modules/tsx/dist/cli.mjs', 'scripts/reindex.ts'],
  ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)],
]) {
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
