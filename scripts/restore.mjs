/**
 * Database restore.
 *
 *   npm run db:restore -- backups/opspilot-<timestamp>.dump            # shows what would happen
 *   npm run db:restore -- backups/opspilot-<timestamp>.dump --confirm  # does it
 *
 * Restoring replaces the contents of DATABASE_URL. It refuses to proceed without --confirm, and
 * always states what it is about to overwrite: the database name, its host, and how many accounts
 * and tickets it currently holds. Restore the whole cluster directory for a .tar produced from the
 * self-contained database; for a .dump, pg_restore is used (natively or inside the compose db).
 */
import 'dotenv/config';
import { existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
// These run real executables (tar.exe, pg_dump.exe, docker.exe), never a shell: with `shell: true`
// Windows concatenates the arguments without quoting, so any path containing a space — the
// documented layout here is "…\AI IT Helpdesk\opspilot-ai" — is split and the command fails.
import pg from 'pg';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const confirm = args.includes('--confirm');
const url = process.env.DATABASE_URL;
if (!file || !existsSync(file)) {
  console.error('Usage: npm run db:restore -- <backup file> [--confirm]');
  process.exit(1);
}
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const parsed = new URL(url);
// The password travels in PGPASSWORD, never on the command line, so it is not visible in the
// process list or a shell history while pg_dump/pg_restore run.
const urlWithoutPassword = (() => { const u = new URL(url); u.password = ''; return u.toString(); })();
const pgEnv = { ...process.env, ...(parsed.password ? { PGPASSWORD: decodeURIComponent(parsed.password) } : {}) };
const database = parsed.pathname.slice(1);
const has = (cmd) => spawnSync(cmd, ['--version'], { encoding: 'utf8', windowsHide: true }).status === 0;

async function describeTarget() {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const users = await client.query('SELECT count(*)::int AS n FROM "User"').catch(() => ({ rows: [{ n: 0 }] }));
    const tickets = await client.query('SELECT count(*)::int AS n FROM "Ticket"').catch(() => ({ rows: [{ n: 0 }] }));
    await client.end();
    return { reachable: true, users: users.rows[0].n, tickets: tickets.rows[0].n };
  } catch {
    await client.end().catch(() => {});
    return { reachable: false, users: 0, tickets: 0 };
  }
}

const target = await describeTarget();
console.log(`\n  Restore ${file}`);
console.log(`  into   "${database}" on ${parsed.host}${target.reachable ? ` — currently ${target.users} account(s), ${target.tickets} ticket(s)` : ' — not reachable right now'}`);
console.log('  Everything in that database will be replaced.\n');
if (!confirm) {
  console.log('  Dry run. Add --confirm to proceed.\n');
  process.exit(0);
}

if (file.endsWith('.tar')) {
  if (!existsSync('.local-db')) {
    console.error('  ✗ A .tar backup is a copy of the self-contained database; this project has no .local-db/ to restore into.');
    process.exit(1);
  }
  if (target.reachable) {
    console.error('  ✗ Stop the self-contained database first (Ctrl+C in its window), then run this again.');
    process.exit(1);
  }
  rmSync('.local-db/data', { recursive: true, force: true });
  const r = spawnSync('tar', ['-xf', file, '-C', '.local-db'], { stdio: 'inherit', windowsHide: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
  console.log('\n  ✓ Restored. Start the database with npm run db:local (or npm run dev:local).\n');
  process.exit(0);
}

if (!target.reachable) {
  console.error('  ✗ The database is not reachable; start it and run this again.');
  process.exit(1);
}
const restoreArgs = ['--clean', '--if-exists', '--no-owner', '--no-privileges', '--single-transaction'];
if (has('pg_restore')) {
  console.log('  Restoring with pg_restore…');
  const r = spawnSync('pg_restore', [...restoreArgs, '--dbname', urlWithoutPassword, file], { stdio: 'inherit', windowsHide: true, env: pgEnv });
  if (r.status !== 0) process.exit(r.status ?? 1);
} else if (has('docker')) {
  console.log('  Restoring with pg_restore inside the db container…');
  const { readFileSync } = await import('node:fs');
  const r = spawnSync('docker', ['compose', 'exec', '-T', 'db', 'pg_restore', ...restoreArgs, '-U', parsed.username || 'opspilot', '--dbname', database], { input: readFileSync(file), stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
} else {
  console.error('  ✗ Neither pg_restore nor docker is available.');
  process.exit(1);
}
console.log('\n  ✓ Restored. Run npm run db:migrate in case the backup predates the current schema, then npm run doctor.\n');
