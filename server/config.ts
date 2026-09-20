import 'dotenv/config';
import { parseConfig } from './config-schema.js';
export { parseConfig };
function load() {
  try {
    return parseConfig(process.env);
  } catch (error) {
    // Fail fast and readably: name the setting, never print its value, and exit with a code the
    // launchers recognise (12 = invalid configuration).
    const e = error as { issues?: { path: (string | number)[]; message: string }[]; message?: string };
    const lines = e.issues ? e.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) : [(e.message ?? String(error)).replace(/postgres(ql)?:\/\/[^\s]+/gi, 'postgresql://…')];
    process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'error', message: 'invalid configuration', settings: lines })}\n`);
    process.exit(12);
  }
}
export const config = load();
/**
 * The key material for encrypting secrets at rest. In production this is APP_SECRET, which
 * startup insists on. Outside production a fixed value keeps a first run working; it is not a
 * secret and the log says so once.
 */
export const appSecret =
  config.APP_SECRET ?? 'opspilot-development-only-secret-do-not-use-in-production';
if (!config.APP_SECRET && config.NODE_ENV !== 'test')
  console.warn('APP_SECRET is not set; using the fixed development value. Set it before any real use.');
