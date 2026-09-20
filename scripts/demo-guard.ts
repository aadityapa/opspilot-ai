/**
 * The conditions under which the demo workspace may be erased and re-seeded.
 *
 * `npm run demo:reset` empties every application table. That is exactly what a sales demo needs
 * between runs and exactly what a real installation must never be exposed to, so the decision lives
 * here as a pure function with no database and no side effects: it can be read in one screen and
 * pinned by a test (`tests/demo.test.ts`) rather than discovered on the day somebody points the
 * command at production.
 *
 * Every condition must hold. Any one of them failing returns the sentence the operator sees, and
 * the caller stops without touching anything.
 */

export interface DemoResetContext {
  nodeEnv: string;
  /** `ALLOW_DEMO_SEED` exactly as configured; only the string "true" permits demo data. */
  allowDemoSeed: string | undefined;
  demoPassword: string | undefined;
  databaseUrl: string;
}

/** Hosts a demo database may live on: this machine, or the compose service beside it. */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', 'db'];

/** The reason demo:reset must refuse, or null when every condition holds. */
export function demoResetRefusal(ctx: DemoResetContext): string | null {
  if (ctx.nodeEnv === 'production')
    return 'demo:reset refuses to run with NODE_ENV=production. A production installation is never demo data.';
  if (ctx.allowDemoSeed !== 'true')
    return 'demo:reset needs ALLOW_DEMO_SEED=true in .env. Production installations set it to false, which disables both the seed and the reset.';
  if (!ctx.demoPassword)
    return 'demo:reset needs DEMO_PASSWORD in .env: it is the password the four demo accounts are re-created with.';
  let host: string;
  try {
    host = new URL(ctx.databaseUrl).hostname;
  } catch {
    return 'demo:reset could not read DATABASE_URL. Nothing was changed.';
  }
  if (!LOCAL_HOSTS.includes(host))
    // The host is named because the operator has to recognise their own mistake; the URL, which
    // carries the password, is never echoed.
    return `demo:reset only runs against a database on this machine, and DATABASE_URL points at "${host}". Nothing was changed.`;
  return null;
}

/** The reason to refuse once the database itself has been looked at, or null. */
export function nonDemoAccountRefusal(count: number): string | null {
  return count > 0
    ? `Refusing: this database holds ${count} account(s) that are not demo accounts. Nothing was changed.`
    : null;
}
