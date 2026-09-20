/**
 * A self-contained PostgreSQL server, for machines without Docker.
 *
 * Docker Desktop is the documented path and the one Compose describes. This is the fallback: an
 * embedded PostgreSQL that needs no Docker, no service install and no administrator rights. It
 * stores its data under `.local-db/` in the repository, which is git-ignored.
 *
 *   npm.cmd run db:local        # start it, and keep it running until you press Ctrl+C
 *
 * Leave it running in one terminal and run `npm.cmd run dev` in another — or use
 * `npm.cmd run dev:local`, which starts the database and the application together.
 *
 * The binaries are downloaded on first use by the `embedded-postgres` package, so the first start
 * takes a minute or two. After that it is instant.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createConnection } from 'node:net';
import { spawnSync } from 'node:child_process';

/**
 * Pinned exactly, not by range. Every published `embedded-postgres` release carries a `-beta` tag,
 * so a range like `@18` resolves to nothing at all; and an exact pin is what makes this
 * reproducible. This version ships PostgreSQL 18 binaries for windows-x64, darwin-arm64,
 * darwin-x64 and linux-x64/arm64, which covers every machine this project is meant to run on.
 */
const EMBEDDED_POSTGRES_VERSION = '18.4.0-beta.17';

const DATA_DIR = resolve('.local-db/data');
const PORT = Number(process.env.LOCAL_DB_PORT ?? 5433);
/** Where PostgreSQL puts its Unix-socket lock on macOS and Linux. Unused on Windows. */
const SOCKET_DIR = process.env.PGHOST?.startsWith('/') ? process.env.PGHOST : '/tmp';
const USER = 'opspilot';
const PASSWORD = 'local-only-db-password';
export const LOCAL_DB_URL = (database) => `postgresql://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${database}`;

/** The package's own entry point, as an absolute URL, or null if it is not installed. */
function installedEntryPoint() {
  const packageRoot = new URL('../node_modules/embedded-postgres/', import.meta.url);
  const manifest = new URL('package.json', packageRoot);
  if (!existsSync(manifest)) return null;
  const { exports: entry, main } = JSON.parse(readFileSync(manifest, 'utf8'));
  const relative = typeof entry === 'string' ? entry : (main ?? 'index.js');
  return new URL(relative, packageRoot).href;
}

/**
 * Installs `embedded-postgres` on demand, so someone using Docker never pays for a dependency they
 * do not need.
 *
 * The second import deliberately goes through the resolved file URL rather than the package name.
 * Node caches a failed module resolution for the life of the process, so `import('embedded-postgres')`
 * would keep failing in this same run even after npm has put the package on disk.
 */
export async function loadEmbeddedPostgres() {
  const alreadyThere = installedEntryPoint();
  if (alreadyThere) return (await import(alreadyThere)).default;

  console.log('Downloading a self-contained PostgreSQL (one time, a minute or two)…');
  const install = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    // --no-save: this is a local convenience, not a project dependency. package.json and the
    // lockfile stay exactly as committed, so a Docker user's install is unaffected.
    ['install', `embedded-postgres@${EMBEDDED_POSTGRES_VERSION}`, '--no-audit', '--no-fund', '--no-save'],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if (install.status !== 0)
    throw new Error(
      'Could not download a self-contained PostgreSQL (no internet, or npm is blocked).\n' +
        '    Install Docker Desktop and run `docker compose up -d db mailpit`, or install PostgreSQL\n' +
        '    yourself and point DATABASE_URL at it.',
    );

  const entry = installedEntryPoint();
  if (!entry) throw new Error('embedded-postgres installed but its files are not where they should be.');
  return (await import(entry)).default;
}

/** True when something is already accepting TCP connections on the local database port. */
const portAnswering = () =>
  new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port: PORT });
    const done = (answer) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(700);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });

/**
 * A PostgreSQL lock file records the postmaster's process id on line 1 and its data directory on
 * line 2. Both matter: the process id says whether anyone still holds it, and the data directory
 * says whose it is.
 */
function readLock(lockFile) {
  const [pid, dataDir] = readFileSync(lockFile, 'utf8').split('\n');
  return { pid: Number(pid?.trim()), dataDir: dataDir?.trim() ?? '' };
}

/** 'gone' | 'running' | 'unknown' — "unknown" when the system will not say (EPERM in a container). */
function processState(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return 'gone';
  try {
    process.kill(pid, 0); // signal 0 tests for existence without touching the process
    return 'running';
  } catch (error) {
    return error?.code === 'ESRCH' ? 'gone' : 'unknown';
  }
}

/**
 * Clears the lock files left behind by a server that was killed rather than shut down — closing the
 * terminal window, a crash, or the machine going to sleep. PostgreSQL refuses to start while they
 * are there, and the message it gives ("lock file already exists") sends people hunting for a
 * process that no longer exists.
 *
 * There are two: `postmaster.pid` in the data directory, and, on macOS and Linux, a Unix-socket lock
 * in the socket directory. Windows has no socket lock.
 *
 * A lock is removed only when it is safe to say nobody wants it: either it belongs to this data
 * directory (nothing was answering on the port a moment ago, so our own server is not running), or
 * the process it names is provably gone. A lock naming somebody else's data directory and a process
 * we cannot ask about is left alone and reported, because deleting it could let a second postmaster
 * take a socket a live server is still using.
 */
function clearStaleLocks({ quiet }) {
  const candidates = [resolve(DATA_DIR, 'postmaster.pid')];
  if (process.platform !== 'win32') candidates.push(resolve(SOCKET_DIR, `.s.PGSQL.${PORT}.lock`));

  const cleared = [];
  const blocking = [];
  for (const lockFile of candidates) {
    if (!existsSync(lockFile)) continue;
    let lock;
    try {
      lock = readLock(lockFile);
    } catch {
      continue;
    }
    const ours = lock.dataDir === DATA_DIR;
    const state = processState(lock.pid);
    if (state === 'running' || (!ours && state === 'unknown')) {
      blocking.push({ lockFile, ...lock });
      continue;
    }
    try {
      rmSync(lockFile, { force: true });
      cleared.push(lockFile);
    } catch {
      blocking.push({ lockFile, ...lock });
    }
  }

  if (cleared.length && !quiet)
    console.log('Cleared a lock file left by a previous run that did not shut down cleanly.');

  if (blocking.length && !quiet)
    for (const lock of blocking)
      console.log(
        `A PostgreSQL lock at ${lock.lockFile} is held by process ${lock.pid} for ${lock.dataDir}.\n` +
          'If that server is really gone, delete the file and start again; otherwise stop it first, or\n' +
          `set LOCAL_DB_PORT to a free port.`,
      );
}

/**
 * Starts the embedded server and returns a handle with `stop()`.
 *
 * If a database is already listening on the port — because `npm run db:local` is open in another
 * terminal — that one is adopted instead of starting a second server on the same data directory,
 * and `stop()` becomes a no-op so this process does not shut down a database it did not start.
 */
export async function startLocalDatabase({ quiet = false } = {}) {
  if (await portAnswering()) {
    if (!quiet) console.log(`A database is already running on 127.0.0.1:${PORT} — using it.`);
    return { stop: async () => {}, adopted: true };
  }

  const EmbeddedPostgres = await loadEmbeddedPostgres();
  mkdirSync(DATA_DIR, { recursive: true });
  clearStaleLocks({ quiet });

  // The library reports failures through these callbacks and then rejects with nothing useful, so
  // keep the last few lines and attach them to the error the caller sees.
  const recent = [];
  const remember = (line) => {
    const text = String(line).trim();
    if (text) recent.push(text.length > 300 ? `${text.slice(0, 300)}…` : text);
    if (recent.length > 6) recent.shift();
  };

  const server = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    onLog: remember,
    onError: remember,
  });

  if (!existsSync(resolve(DATA_DIR, 'PG_VERSION'))) {
    if (!quiet) console.log('Preparing the local database directory (first run only)…');
    await server.initialise();
  }

  try {
    await server.start();
  } catch (error) {
    const detail = recent.length ? `\n    ${recent.join('\n    ')}` : '';
    throw new Error(`${error?.message ?? 'PostgreSQL would not start.'}${detail}`);
  }

  if (!quiet) console.log(`Local PostgreSQL is running on 127.0.0.1:${PORT} (data in .local-db/).`);
  return { stop: () => server.stop(), adopted: false };
}

// Run directly: start and stay up until interrupted.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startLocalDatabase();
  if (server.adopted) {
    console.log('\nNothing to do — the database is already running somewhere else.');
    process.exit(0);
  }
  console.log('\nLeave this window open. Press Ctrl+C to stop the database.');
  console.log('In another terminal, run:  npm.cmd run dev\n');
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log('\nStopping the local database…');
    try {
      await server.stop();
    } catch {
      /* already gone */
    }
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  // Keep the process alive.
  setInterval(() => {}, 1 << 30);
}
