import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { assertDisposableDatabase } from './guard-database.mjs';

const url = process.env.TEST_DATABASE_URL;
// The name is checked, and so is the database itself: a populated workspace is refused even if it
// happens to be called "..._test". See scripts/guard-database.mjs.
const guard = await assertDisposableDatabase(url, {
  purpose: 'the API/unit test suite',
  expectedSuffix: '_test',
  appUrl: process.env.DATABASE_URL,
});
if (guard.decision !== 'already-marked')
  console.log(`Claimed "${guard.name}" as a disposable test database.`);

const env = {
  ...process.env,
  DATABASE_URL: url,
  NODE_ENV: 'test',
  ALLOW_DEMO_SEED: 'false',
  // The metrics endpoint is disabled without a token; the suite needs one to exercise it.
  METRICS_TOKEN: 'test-only-metrics-token',
  // The suites sign in dozens of times from one loopback address. The limiter stays active but
  // raised, exactly as the browser suite does; the production default is unchanged.
  LOGIN_RATE_LIMIT: '1000',
  // Request logs are asserted by the observability suite, so they stay on; the rest is quiet enough.
  LOG_FORMAT: 'json',
};
for (const args of [
  ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  ['node_modules/vitest/vitest.mjs', 'run'],
]) {
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
