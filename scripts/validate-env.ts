/**
 * Validates .env with the same parser the server uses, before anything starts, and explains a
 * problem by setting name only — never by value. Exit codes: 0 valid, 12 invalid.
 *
 *   npx tsx scripts/validate-env.ts
 */
import 'dotenv/config';
import { parseConfig } from '../server/config-schema.js';

try {
  const c = parseConfig(process.env);
  const host = new URL(c.DATABASE_URL).host;
  console.log(`Settings are valid: NODE_ENV=${c.NODE_ENV}, database at ${host}, origin ${c.APP_ORIGIN}, AI ${c.AI_MODE}, mail ${c.MAIL_MODE}.`);
} catch (error) {
  const e = error as { issues?: { path: (string | number)[]; message: string }[]; message?: string };
  console.error('\n  ✗ The settings in .env are not valid.');
  if (e.issues) for (const i of e.issues) console.error(`    ${i.path.join('.') || '(root)'}: ${i.message}`);
  else console.error(`    ${(e.message ?? String(error)).replace(/postgres(ql)?:\/\/[^\s]+/gi, 'postgresql://…')}`);
  console.error('    Fix the setting named above in .env and start again. Values are never printed here.\n');
  process.exit(12);
}
