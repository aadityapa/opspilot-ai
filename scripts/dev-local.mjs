/**
 * Start the self-contained database and the application together.
 *
 *   npm.cmd run dev:local
 *
 * For machines without Docker. It starts the embedded PostgreSQL, waits until it actually accepts
 * connections, then runs the normal `npm run dev`. Ctrl+C stops both, in the right order.
 *
 * If you have Docker, or your own PostgreSQL, use `npm.cmd run dev` instead — this script is only
 * the no-Docker path.
 */
import { spawn } from 'node:child_process';
import pg from 'pg';
import { startLocalDatabase, LOCAL_DB_URL } from './local-db.mjs';
import { upgradeDatabase } from './upgrade-db.mjs';

const isWindows = process.platform === 'win32';

async function accepting(url) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch (error) {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
    return error?.code === '3D000'; // server is up, that database just isn't there
  }
}

console.log('Starting the local database…');
const server = await startLocalDatabase({ quiet: true });

let ready = false;
for (let attempt = 0; attempt < 30 && !ready; attempt++) {
  ready = await accepting(LOCAL_DB_URL('postgres'));
  if (!ready) await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!ready) {
  console.error('The local database did not start. Run `npm run doctor` to see what went wrong.');
  await server.stop().catch(() => {});
  process.exit(1);
}
console.log('Local database ready on 127.0.0.1:5433.');
// New code, old database: apply anything pending before the API starts querying.
try {
  await upgradeDatabase();
} catch (error) {
  console.error(error.message);
  await server.stop().catch(() => {});
  process.exit(error.code === 10 || error.code === 11 ? error.code : 1);
}
console.log('');

const app = spawn(isWindows ? 'npm.cmd' : 'npm', ['run', 'dev'], {
  stdio: 'inherit',
  shell: isWindows,
});

let stopping = false;
const stop = async (code = 0) => {
  if (stopping) return;
  stopping = true;
  if (!app.killed) app.kill('SIGINT');
  console.log('\nStopping the local database…');
  await server.stop().catch(() => {});
  process.exit(code);
};

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
app.on('exit', (code) => stop(code ?? 0));
