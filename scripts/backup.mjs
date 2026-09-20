/**
 * Database backup.
 *
 *   npm run db:backup                 # → backups/opspilot-<timestamp>.dump
 *   npm run db:backup -- --out path   # choose the file
 *
 * Picks whichever of these is available, in order:
 *   1. pg_dump on PATH                       (any PostgreSQL; custom format, compressed)
 *   2. pg_dump inside the compose db container
 *   3. a file-level copy of .local-db/data   (the self-contained database; only while it is stopped)
 *
 * The output never contains the connection password. Restore with `npm run db:restore -- <file>`.
 */
import 'dotenv/config';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
// These run real executables (tar.exe, pg_dump.exe, docker.exe), never a shell: with `shell: true`
// Windows concatenates the arguments without quoting, so any path containing a space — the
// documented layout here is "…\AI IT Helpdesk\opspilot-ai" — is split and the command fails.
import { resolve } from 'node:path';
import { createConnection } from 'node:net';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Run npm run setup, or export it.');
  process.exit(1);
}
const parsed = new URL(url);
// The password travels in PGPASSWORD, never on the command line, so it is not visible in the
// process list or a shell history while pg_dump/pg_restore run.
const urlWithoutPassword = (() => { const u = new URL(url); u.password = ''; return u.toString(); })();
const pgEnv = { ...process.env, ...(parsed.password ? { PGPASSWORD: decodeURIComponent(parsed.password) } : {}) };
const database = parsed.pathname.slice(1);
mkdirSync('backups', { recursive: true });

const has = (cmd) => spawnSync(cmd, ['--version'], { encoding: 'utf8', windowsHide: true }).status === 0;
const portOpen = (host, port) =>
  new Promise((done) => {
    const s = createConnection({ host, port });
    const finish = (v) => { s.destroy(); done(v); };
    s.setTimeout(700);
    s.once('connect', () => finish(true));
    s.once('timeout', () => finish(false));
    s.once('error', () => finish(false));
  });

const report = (file) => {
  const size = statSync(file).size;
  console.log(`\n  ✓ Backup written: ${file} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  console.log('    Keep it somewhere other than this machine. It contains every ticket, article and account.');
  console.log(`    Restore with: npm run db:restore -- ${file}\n`);
};

// 1. Native pg_dump.
if (has('pg_dump')) {
  const file = outIndex >= 0 ? args[outIndex + 1] : resolve('backups', `opspilot-${stamp}.dump`);
  console.log(`Backing up "${database}" with pg_dump…`);
  const r = spawnSync('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--file', file, urlWithoutPassword], { stdio: 'inherit', windowsHide: true, env: pgEnv });
  if (r.status !== 0) process.exit(r.status ?? 1);
  report(file);
  process.exit(0);
}

// 2. pg_dump inside the compose container.
if (has('docker')) {
  const running = spawnSync('docker', ['compose', 'ps', '--status', 'running', '--services'], { encoding: 'utf8', windowsHide: true });
  if (running.status === 0 && running.stdout.split('\n').map((s) => s.trim()).includes('db')) {
    const file = outIndex >= 0 ? args[outIndex + 1] : resolve('backups', `opspilot-${stamp}.dump`);
    console.log(`Backing up "${database}" with pg_dump inside the db container…`);
    const r = spawnSync('docker', ['compose', 'exec', '-T', 'db', 'pg_dump', '--format=custom', '--no-owner', '--no-privileges', '-U', parsed.username || 'opspilot', database], { encoding: 'buffer', maxBuffer: 1024 * 1024 * 1024, windowsHide: true });
    if (r.status !== 0) {
      process.stderr.write(r.stderr);
      process.exit(r.status ?? 1);
    }
    const { writeFileSync } = await import('node:fs');
    writeFileSync(file, r.stdout);
    report(file);
    process.exit(0);
  }
}

// 3. File-level copy of the self-contained database.
if (existsSync('.local-db/data/PG_VERSION')) {
  const host = parsed.hostname === 'localhost' ? '127.0.0.1' : parsed.hostname;
  if (await portOpen(host, Number(parsed.port || 5432))) {
    console.error('\n  ✗ The self-contained database is running. Stop it (Ctrl+C in its window) and run this again.');
    console.error('    A copy taken while PostgreSQL is writing is not guaranteed to be consistent.\n');
    process.exit(1);
  }
  const file = outIndex >= 0 ? args[outIndex + 1] : resolve('backups', `opspilot-localdb-${stamp}.tar`);
  console.log('Copying .local-db/data (file-level backup of the self-contained database)…');
  const r = spawnSync('tar', ['-cf', file, '-C', '.local-db', 'data'], { stdio: 'inherit', windowsHide: true });
  if (r.status !== 0) {
    console.error('tar is not available. On Windows 10+ it is built in; otherwise copy the .local-db folder by hand.');
    process.exit(r.status ?? 1);
  }
  report(file);
  process.exit(0);
}

console.error('\n  ✗ No way to back up: pg_dump is not installed, no compose db container is running, and there is no .local-db/.');
console.error('    Install the PostgreSQL client tools (pg_dump) and run this again.\n');
process.exit(1);
