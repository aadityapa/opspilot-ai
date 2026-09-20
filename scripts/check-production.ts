/**
 * Validates .env.production the way the application and compose.prod.yaml will, before anything
 * is built or started.
 *
 *   npm run doctor:prod            # reads .env.production
 *   npm run doctor:prod -- path    # reads another file
 *
 * It composes the same environment compose.prod.yaml would hand the container, runs it through the
 * real parseConfig with NODE_ENV=production, and then applies the checks that only make sense
 * before a deployment: secret strength, no development values, no key without the mode that uses
 * it. Nothing is printed that would identify a secret.
 */
import { existsSync, readFileSync } from 'node:fs';
import { parseConfig } from '../server/config-schema.js';

const file = process.argv[2] ?? '.env.production';
const problems: string[] = [];
const warnings: string[] = [];
const ok: string[] = [];

if (!existsSync(file)) {
  console.error(`\n  ✗ ${file} does not exist. Copy .env.production.example and fill it in.\n`);
  process.exit(1);
}

const values = Object.fromEntries(
  readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const need = (key: string, why: string) => {
  if (!values[key]) problems.push(`${key} is required — ${why}`);
  else ok.push(`${key} is set`);
};
need('DOMAIN', 'it becomes APP_ORIGIN and the TLS certificate name');
need('ACME_EMAIL', 'the certificate authority needs a contact address');
need('POSTGRES_PASSWORD', 'the database has no default password');
need('APP_SECRET', 'second-factor secrets are encrypted with it');

const weak = (value: string | undefined) => !value || value.length < 24 || /^(password|secret|changeme|local-only)/i.test(value);
if (values.POSTGRES_PASSWORD && weak(values.POSTGRES_PASSWORD)) problems.push('POSTGRES_PASSWORD is too short or looks like a placeholder (24+ random characters)');
if (values.APP_SECRET && values.APP_SECRET.length < 32) problems.push('APP_SECRET must be at least 32 characters');
if (values.APP_SECRET && /development-only/.test(values.APP_SECRET)) problems.push('APP_SECRET is the development placeholder');
if (values.DOMAIN && /^(localhost|127\.|0\.0\.0\.0)/.test(values.DOMAIN)) problems.push('DOMAIN must be a public host name, not localhost');
if (values.DOMAIN && /^https?:\/\//.test(values.DOMAIN)) problems.push('DOMAIN is a host name only — no scheme, no path');
if (values.METRICS_TOKEN && values.METRICS_TOKEN.length < 24) problems.push('METRICS_TOKEN should be at least 24 random characters, or empty to disable /metrics');
if (!values.METRICS_TOKEN) warnings.push('METRICS_TOKEN is empty, so /metrics is disabled');
if (values.AI_MODE === 'openai' && !values.OPENAI_API_KEY) problems.push('AI_MODE=openai needs OPENAI_API_KEY');
if (values.AI_MODE !== 'openai' && values.OPENAI_API_KEY) problems.push('OPENAI_API_KEY is set but AI_MODE is not openai — remove one');
if (values.AI_MODE === 'openai') warnings.push('AI_MODE=openai: ticket text and questions will be sent to OpenAI; confirm that is acceptable for your data');
if (values.MAIL_MODE && values.MAIL_MODE !== 'disabled') problems.push('MAIL_MODE must be disabled in production (Mailpit is a local sink; no other transport exists)');
if (values.ALLOW_DEMO_SEED === 'true') problems.push('ALLOW_DEMO_SEED must not be true in production');
if (values.DEMO_PASSWORD) warnings.push('DEMO_PASSWORD is present; it is ignored in production, but should not be in this file');
if (!values.MFA_REQUIRED_ROLES) warnings.push('MFA_REQUIRED_ROLES is empty — consider at least ADMIN');

// Compose the environment exactly as compose.prod.yaml does, then run the real validator.
const composed: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: `postgresql://opspilot:${values.POSTGRES_PASSWORD || 'x'}@db:5432/opspilot`,
  APP_ORIGIN: `https://${values.DOMAIN || 'example.invalid'}`,
  APP_SECRET: values.APP_SECRET,
  PORT: '3001',
  ALLOW_DEMO_SEED: 'false',
  MAIL_MODE: 'disabled',
  AI_MODE: values.AI_MODE || 'disabled',
  OPENAI_API_KEY: values.OPENAI_API_KEY,
  AI_CHAT_MODEL: values.AI_CHAT_MODEL,
  AI_EMBEDDING_MODEL: values.AI_EMBEDDING_MODEL,
  AI_EMBEDDING_DIMENSIONS: values.AI_EMBEDDING_DIMENSIONS,
  MFA_REQUIRED_ROLES: values.MFA_REQUIRED_ROLES,
  LOGIN_RATE_LIMIT: values.LOGIN_RATE_LIMIT,
  LOCKOUT_THRESHOLD: values.LOCKOUT_THRESHOLD,
  LOCKOUT_MINUTES: values.LOCKOUT_MINUTES,
  SESSION_HOURS: values.SESSION_HOURS,
  METRICS_TOKEN: values.METRICS_TOKEN,
  LOG_FORMAT: 'json',
  RETENTION_AUDIT_DAYS: values.RETENTION_AUDIT_DAYS,
  RETENTION_AI_USAGE_DAYS: values.RETENTION_AI_USAGE_DAYS,
  RETENTION_OUTBOX_DAYS: values.RETENTION_OUTBOX_DAYS,
};
try {
  const c = parseConfig(composed);
  ok.push(`Application configuration validates for ${c.APP_ORIGIN} (AI ${c.AI_MODE}, MFA required for ${c.mfaRequiredRoles.join(', ') || 'nobody'})`);
} catch (error) {
  problems.push(`The application would refuse to start: ${(error as Error).message.split('\n')[0]}`);
}

console.log(`\n  Production pre-flight for ${file}\n`);
for (const line of ok) console.log(`  ✓ ${line}`);
for (const line of warnings) console.log(`  ! ${line}`);
for (const line of problems) console.log(`  ✗ ${line}`);
console.log(problems.length ? `\n  ${problems.length} problem(s). Fix them before deploying.\n` : '\n  Ready. Deploy with:\n    docker compose -f compose.prod.yaml --env-file .env.production up -d --build\n');
process.exit(problems.length ? 1 : 0);
