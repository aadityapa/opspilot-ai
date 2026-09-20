/**
 * Start OpsPilot with whatever database is available. Used by start.bat and `npm start:dev`.
 *
 * Decides between `npm run dev` (a database is already answering) and `npm run dev:local` (the
 * self-contained PostgreSQL in .local-db/), then opens the browser once the API reports healthy.
 * Runs `npm run setup` first if the project has never been set up.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { upgradeDatabase } from './upgrade-db.mjs';

const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? 'npm.cmd' : 'npm';

const portOpen = (host, port, timeoutMs = 800) =>
  new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const done = (answer) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });

const parseEnv = (text) =>
  Object.fromEntries(
    text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  );

// 1. First run? Set up.
if (!existsSync('node_modules') || !existsSync('.env')) {
  console.log('First run — setting up.\n');
  const setup = spawnSync(npmCommand, ['run', 'setup'], { stdio: 'inherit', shell: isWindows });
  if (setup.status !== 0) process.exit(setup.status ?? 1);
}

// 1b. New code may need packages the last install did not have. Check every declared dependency
// is present before starting; a missing one means the app would crash at import time.
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
const missing = declared.filter((name) => !existsSync(`node_modules/${name}/package.json`));
if (missing.length) {
  console.log(`Installing ${missing.length} package(s) added since the last install (${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ', …' : ''})…\n`);
  const install = spawnSync(npmCommand, [existsSync('package-lock.json') ? 'ci' : 'install', '--no-audit', '--no-fund'], { stdio: 'inherit', shell: isWindows });
  if (install.status !== 0) process.exit(install.status ?? 1);
  // The Prisma client must match the current schema too.
  const generate = spawnSync(npmCommand, ['run', 'db:generate'], { stdio: 'inherit', shell: isWindows });
  if (generate.status !== 0) process.exit(generate.status ?? 1);
}

// 2. Which database?
const env = parseEnv(readFileSync('.env', 'utf8'));
let dbHost = '127.0.0.1';
let dbPort = 5433;
try {
  const url = new URL(env.DATABASE_URL);
  dbHost = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname;
  dbPort = Number(url.port || 5432);
} catch {
  /* setup would have refused a bad URL; fall through to defaults */
}

const answering = await portOpen(dbHost, dbPort);
const hasLocal = existsSync('.local-db/data/PG_VERSION');
let script;
if (answering) script = 'dev';
else if (hasLocal) script = 'dev:local';
else {
  console.log(`Nothing is answering at ${dbHost}:${dbPort} and there is no local database yet. Running setup.\n`);
  const setup = spawnSync(npmCommand, ['run', 'setup'], { stdio: 'inherit', shell: isWindows });
  if (setup.status !== 0) process.exit(setup.status ?? 1);
  script = existsSync('.local-db/data/PG_VERSION') ? 'dev:local' : 'dev';
}

// 2b. Validate the settings with the server's own parser before anything starts, so a bad value
// is reported by name here rather than as a crash inside the API process.
const validate = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/validate-env.ts'], { stdio: 'inherit' });
if (validate.status !== 0) process.exit(validate.status ?? 12);

if (script === 'dev') {
  // A database of your own: bring its schema up to date before the API starts (dev:local does this itself).
  try {
    await upgradeDatabase();
  } catch (error) {
    console.error(error.message);
    process.exit(error.code === 10 || error.code === 11 ? error.code : 1);
  }
}
console.log(`Starting with: ${npmCommand} run ${script}\n`);
const app = spawn(npmCommand, ['run', script], { stdio: 'inherit', shell: isWindows });

// 3. Open the browser once the API answers.
const origin = env.APP_ORIGIN || 'http://localhost:5173';
const apiPort = Number(env.PORT || 3001);
(async () => {
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (app.exitCode !== null) return;
    try {
      const res = await fetch(`http://127.0.0.1:${apiPort}/api/health`);
      if (res.ok && (await portOpen('127.0.0.1', Number(new URL(origin).port || 5173)))) {
        console.log(`\nOpsPilot is up at ${origin}\n`);
        if (process.env.OPSPILOT_NO_BROWSER !== '1') {
          const opener = isWindows ? ['cmd', ['/c', 'start', '', origin]] : process.platform === 'darwin' ? ['open', [origin]] : ['xdg-open', [origin]];
          spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).unref();
        }
        return;
      }
    } catch {
      /* not up yet */
    }
  }
})();

const stop = () => {
  if (!app.killed) app.kill('SIGINT');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
app.on('exit', (code) => process.exit(code ?? 0));
