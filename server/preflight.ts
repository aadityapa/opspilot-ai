/**
 * Database preflight: can we reach the database named in DATABASE_URL, and does it exist?
 *
 * Used before migrations run (the container entrypoint, `upgrade-db.mjs`) and by the server at
 * startup. It answers with a category rather than a stack trace, and never repeats the URL, so an
 * operator sees "wrong password" or "nothing answering at host:port", not credentials in a log.
 *
 *   node dist/server/preflight.js            exit 0 reachable · 10 unreachable/refused/missing
 *
 * Why refuse a missing database instead of letting `migrate deploy` create it: a typo in the URL
 * would otherwise produce a fresh, empty schema and an application that starts with no data — the
 * worst possible way to discover a misconfiguration. Databases are created deliberately
 * (`npm run setup`, `POSTGRES_DB` in compose), never as a side effect of starting.
 */
import pg from 'pg';

export type Preflight = { ok: true; host: string; database: string; version: string; encoding: string } | { ok: false; host: string; database: string; reason: string };

/**
 * OpsPilot stores UTF-8 text: audit details read "status: OPEN → RESOLVED", articles and replies
 * carry dashes, quotes and any language someone types. A cluster created in a Windows OS locale is
 * usually WIN1252, which cannot represent those characters — PostgreSQL then rejects the write with
 * SQLSTATE 22P05 and the API answers 500 on ordinary ticket updates. Catch it at startup instead.
 */
export function encodingProblem(encoding: string): string | null {
  if (/^utf-?8$/i.test(encoding.trim())) return null;
  return `the database was created with the ${encoding} encoding, but OpsPilot stores UTF-8 text — ticket updates would fail. Re-create it as UTF-8 (see docs/OPERATIONS-RUNBOOK.md, "Database encoding"), or point DATABASE_URL at a UTF-8 database`;
}

export async function checkDatabase(url: string, timeoutMs = 5000): Promise<Preflight> {
  let host = '?';
  let database = '?';
  try {
    const u = new URL(url);
    host = u.host;
    database = u.pathname.replace(/^\//, '');
  } catch {
    return { ok: false, host, database, reason: 'DATABASE_URL is not a valid URL' };
  }
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: timeoutMs, statement_timeout: timeoutMs });
  try {
    await client.connect();
    const r = await client.query('SELECT version() AS v, current_setting(\'server_encoding\') AS enc');
    const encoding = String(r.rows[0].enc);
    const problem = encodingProblem(encoding);
    if (problem) return { ok: false, host, database, reason: problem };
    return { ok: true, host, database, version: String(r.rows[0].v).split(' (')[0], encoding };
  } catch (error) {
    const e = error as { code?: string; message?: string };
    const reason =
      e.code === '3D000' ? `database "${database}" does not exist on ${host} — create it, or fix DATABASE_URL`
      : e.code === '28P01' || e.code === '28000' ? `authentication failed for the user in DATABASE_URL at ${host}`
      : e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN' || e.code === 'ETIMEDOUT' || /timeout/i.test(e.message ?? '') ? `nothing is answering at ${host} (${e.code ?? 'timeout'})`
      : `connection to ${host} failed (${e.code ?? e.message?.slice(0, 80) ?? 'unknown error'})`;
    return { ok: false, host, database, reason };
  } finally {
    await client.end().catch(() => {});
  }
}

/** Waits for the database with a bounded number of attempts; used at server start. */
export async function waitForDatabase(url: string, attempts: number, intervalMs: number, say: (r: Preflight, attempt: number) => void): Promise<Preflight> {
  let last: Preflight = { ok: false, host: '?', database: '?', reason: 'not attempted' };
  for (let i = 1; i <= attempts; i++) {
    last = await checkDatabase(url);
    say(last, i);
    if (last.ok) return last;
    // Waiting cannot fix a missing database, a wrong password or a wrongly encoded cluster.
    if (last.reason.includes('does not exist') || last.reason.includes('authentication failed') || last.reason.includes('encoding')) return last;
    if (i < attempts) await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}

const isMain = process.argv[1] && /preflight\.(js|ts)$/.test(process.argv[1]);
if (isMain) {
  // Run straight from a developer machine (`npx tsx server/preflight.ts`) the settings come from
  // .env; in a container they are already in the environment and this simply finds nothing to add.
  await import('dotenv/config');
  const result = await checkDatabase(process.env.DATABASE_URL ?? '');
  const line = { ts: new Date().toISOString(), level: result.ok ? 'info' : 'error', message: result.ok ? 'database reachable' : 'database preflight failed', host: result.host, database: result.database, ...(result.ok ? { version: result.version, encoding: result.encoding } : { reason: result.reason }) };
  (result.ok ? process.stdout : process.stderr).write(`${JSON.stringify(line)}\n`);
  process.exit(result.ok ? 0 : 10);
}
