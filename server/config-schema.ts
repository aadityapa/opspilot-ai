import { z } from 'zod';

/**
 * Pure configuration parsing, with no side effects: importing this file reads nothing and prints
 * nothing, so deployment tooling can validate an environment it is not running in.
 */
export function parseConfig(input: NodeJS.ProcessEnv) {
  // A setting that is present but empty means "not set". Without this, a bare `OPENAI_API_KEY=`
  // line — exactly what you get by copying .env.example — fails validation with a Zod stack trace
  // instead of falling back to the default. Empty is how people write "I left this blank".
  const provided = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== ''),
  );
  const c = z
    .object({
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      DATABASE_URL: z.url(),
      APP_ORIGIN: z.url(),
      PORT: z.coerce.number().int().min(1).max(65535).default(3001),
      ALLOW_DEMO_SEED: z.enum(['true', 'false']).default('false'),
      // Failed and successful login attempts allowed per IP per 15 minutes. The default suits a
      // single small company. Raise it only where many users legitimately share one source address
      // (an office behind NAT, or an automated browser suite); it is per-IP, not per-account.
      LOGIN_RATE_LIMIT: z.coerce.number().int().min(5).max(1000).default(20),
      // Server-side secret used to encrypt TOTP secrets at rest and to sign nothing else. Required
      // in production; in development a fixed, clearly insecure value is used so a first run works.
      APP_SECRET: z.string().min(32).max(256).optional(),
      // Account lockout: after this many consecutive failures the account is locked for this long.
      LOCKOUT_THRESHOLD: z.coerce.number().int().min(3).max(50).default(5),
      LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
      // Roles that must have a second factor enrolled before they can use the application.
      // Comma-separated, e.g. "ADMIN,ENGINEER". Empty means MFA is optional for everyone.
      MFA_REQUIRED_ROLES: z.string().max(60).default(''),
      // Session lifetime in hours.
      SESSION_HOURS: z.coerce.number().int().min(1).max(720).default(8),
      // Audit and data retention, in days. 0 disables the pruning of that class of record.
      RETENTION_AUDIT_DAYS: z.coerce.number().int().min(0).max(3650).default(365),
      RETENTION_AI_USAGE_DAYS: z.coerce.number().int().min(0).max(3650).default(90),
      RETENTION_OUTBOX_DAYS: z.coerce.number().int().min(0).max(3650).default(30),
      // Request logging: "json" for one structured line per request, "off" to silence.
      LOG_FORMAT: z.enum(['json', 'off']).default('json'),
      // Bearer token that protects /metrics. Empty disables the endpoint entirely.
      METRICS_TOKEN: z.string().max(200).default(''),
      // Attachments: where files are stored (outside the web root, never served directly) and the
      // per-file limit. Types are allow-listed in server/workspace.ts.
      UPLOAD_DIR: z.string().min(1).max(300).default('uploads'),
      ATTACHMENT_MAX_MB: z.coerce.number().int().min(1).max(100).default(10),
      MAIL_MODE: z.enum(['disabled','mailpit']).default('disabled'),
      MAILPIT_HOST: z.enum(['127.0.0.1','localhost','mailpit']).default('127.0.0.1'),
      MAILPIT_PORT: z.coerce.number().refine(v=>v===1025,'Mailpit must use port 1025').default(1025),
      // AI. "disabled" removes every AI feature; "mock" is deterministic and needs no credentials;
      // "openai" calls the official API. There is deliberately no base-URL setting, so the provider
      // cannot be pointed at an arbitrary host by configuration.
      AI_MODE: z.enum(['disabled','mock','openai']).default('disabled'),
      OPENAI_API_KEY: z.string().min(20).max(400).optional(),
      AI_CHAT_MODEL: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/).default('gpt-4o-mini'),
      AI_EMBEDDING_MODEL: z.enum(['text-embedding-3-small','text-embedding-3-large']).default('text-embedding-3-small'),
      AI_EMBEDDING_DIMENSIONS: z.coerce.number().int().min(16).max(3072).default(1536),
      AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(20000),
      AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(8000).default(900),
      AI_MAX_INPUT_CHARS: z.coerce.number().int().min(500).max(100000).default(12000),
      AI_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
      AI_DAILY_USER_LIMIT: z.coerce.number().int().min(1).max(10000).default(50),
      AI_RETRIEVAL_TOP_K: z.coerce.number().int().min(1).max(20).default(5),
      // Evidence bars, applied by the server regardless of what the model claims. The retrieval
      // floor decides what is a *candidate*; these decide what counts as *support*. Chosen from the
      // development evaluation set and validated on held-out cases — see docs/EVALUATION.md.
      AI_MIN_ANSWER_SIMILARITY: z.coerce.number().min(0).max(1).default(0.2),
      AI_MIN_QUESTION_TERM_OVERLAP: z.coerce.number().min(0).max(1).default(0.25),
      AI_MIN_CITATION_SUPPORT: z.coerce.number().min(0).max(1).default(0.12),
      // Absolute cosine floor below which nothing counts as evidence. Mock and real embedding
      // models occupy differently-scaled spaces, so this is configurable rather than fixed.
      AI_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.1),
    })
    .parse(provided);
  if (new URL(c.APP_ORIGIN).origin !== c.APP_ORIGIN)
    throw new Error('APP_ORIGIN must be an origin without a path');
  if (c.NODE_ENV === 'production' && !c.APP_SECRET)
    throw new Error('Production requires APP_SECRET (at least 32 characters). Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"');
  const mfaRoles = c.MFA_REQUIRED_ROLES.split(',').map((r) => r.trim()).filter(Boolean);
  for (const role of mfaRoles)
    if (!['EMPLOYEE', 'ENGINEER', 'ADMIN'].includes(role))
      throw new Error(`MFA_REQUIRED_ROLES contains an unknown role: ${role}`);
  if (
    c.NODE_ENV === 'production' &&
    (c.ALLOW_DEMO_SEED === 'true' || !c.APP_ORIGIN.startsWith('https://'))
  )
    throw new Error('Production requires HTTPS and demo seeding disabled');
  // Mailpit is a local development sink with no authentication. Refuse it in production at startup
  // rather than letting every delivery attempt fail and retry.
  if (c.NODE_ENV === 'production' && c.MAIL_MODE !== 'disabled')
    throw new Error('Production requires MAIL_MODE=disabled; Mailpit is a local testing sink only');
  // Fail at startup rather than at the first request, so a misconfigured AI setup is obvious.
  if (c.AI_MODE === 'openai' && !c.OPENAI_API_KEY)
    throw new Error('AI_MODE=openai requires OPENAI_API_KEY');
  if (c.AI_MODE !== 'openai' && c.OPENAI_API_KEY)
    throw new Error('OPENAI_API_KEY is set but AI_MODE is not "openai"; remove one of them');
  // text-embedding-3 models accept a reduced dimension count, but never more than their native size.
  const nativeDimensions = c.AI_EMBEDDING_MODEL === 'text-embedding-3-large' ? 3072 : 1536;
  if (c.AI_EMBEDDING_DIMENSIONS > nativeDimensions)
    throw new Error(`AI_EMBEDDING_DIMENSIONS cannot exceed ${nativeDimensions} for ${c.AI_EMBEDDING_MODEL}`);
  return { ...c, mfaRequiredRoles: mfaRoles as ('EMPLOYEE' | 'ENGINEER' | 'ADMIN')[] };
}
