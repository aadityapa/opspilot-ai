/**
 * Opt-in evaluation against a real AI provider.
 *
 * This is deliberately NOT part of `npm test` and NOT part of CI. It spends money on a real API
 * key, and its results depend on a third-party model that can change without notice.
 *
 * Run it yourself, on purpose:
 *   $env:AI_MODE = 'openai'
 *   $env:OPENAI_API_KEY = '<your key>'
 *   $env:TEST_DATABASE_URL = 'postgresql://...opspilot_test'
 *   npm.cmd run eval:real
 *
 * It uses the same fictional dataset as the deterministic mock evaluation, so the two are directly
 * comparable. A mock pass says the plumbing is correct. Only this says anything about a real
 * model's behaviour, and even then only for the model, prompt and dataset used on the day.
 */
import 'dotenv/config';
import { spawnSync } from 'node:child_process';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error('Set TEST_DATABASE_URL to a dedicated database ending in _test. See README.');
if (process.env.AI_MODE !== 'openai')
  throw new Error('Set AI_MODE=openai. This script exists to exercise a real provider; use npm test for the mock.');
if (!process.env.OPENAI_API_KEY) throw new Error('Set OPENAI_API_KEY. Nothing is read from the repository.');

console.log(
  [
    '',
    'Real-provider evaluation',
    '------------------------',
    `  chat model:      ${process.env.AI_CHAT_MODEL ?? 'gpt-4o-mini (default)'}`,
    `  embedding model: ${process.env.AI_EMBEDDING_MODEL ?? 'text-embedding-3-small (default)'}`,
    '',
    '  This calls a paid API. It embeds a handful of short fictional articles and asks eleven',
    '  short questions, so the cost is small, but it is not zero and it is billed to your account.',
    '  Token usage is measured and reported; no monetary figure is estimated here because prices',
    '  change and vary by plan. Check your provider dashboard for billing.',
    '',
  ].join('\n'),
);

const result = spawnSync(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'run', 'tests/eval/knowledge-eval.test.ts', '--reporter=verbose'],
  {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url, NODE_ENV: 'test', ALLOW_DEMO_SEED: 'false', AI_EVAL_REAL: 'true' },
  },
);

if (result.status !== 0) {
  console.error(
    '\nThe real-provider evaluation reported failures. Safety expectations are assertions and must' +
      '\nhold for any provider. Quality misses are expected to vary between models and runs — record' +
      '\nwhat you measured in docs/VALIDATION.md rather than re-running until it looks good.\n',
  );
  process.exit(result.status ?? 1);
}
console.log('\nRecord the printed scorecard, the model name and the date in docs/VALIDATION.md.\n');
