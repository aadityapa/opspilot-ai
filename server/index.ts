import express from 'express';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { db } from './db.js';
import { config } from './config.js';
import { startWorker } from './notifications.js';
import { runRetention } from './governance.js';
import { beginShutdown, log } from './observability.js';
import { waitForDatabase } from './preflight.js';
import { closeAllStreams, openStreams } from './realtime.js';

// Fail fast and readably when the database is not there. Up to thirty seconds of waiting covers a
// database container that is still starting; a wrong password or a missing database is reported at
// once because waiting cannot fix it. Exit code 10 is what the launchers and runbook expect.
const reachable = await waitForDatabase(config.DATABASE_URL, config.NODE_ENV === 'test' ? 1 : 10, 3000, (r, attempt) => {
  if (!r.ok) log('warn', 'database not reachable yet', { attempt, host: r.host, database: r.database, reason: r.reason });
});
if (!reachable.ok) {
  log('error', 'database preflight failed; not starting', { host: reachable.host, database: reachable.database, reason: reachable.reason });
  process.exit(10);
}
await db.$connect();
const app = createApp();
const stopWorker = startWorker();

// Retention runs once shortly after start and then daily. Failures are logged and retried next day.
const retention = setInterval(() => void runRetention().catch((e) => log('error', 'retention failed', { errorName: (e as Error).name })), 24 * 60 * 60 * 1000);
retention.unref();
const firstRetention = setTimeout(() => void runRetention().catch((e) => log('error', 'retention failed', { errorName: (e as Error).name })), 60_000);
firstRetention.unref();

if (config.NODE_ENV === 'production') {
  app.use(express.static(resolve('dist/web'), { maxAge: '1h', index: false }));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/web/index.html')));
}

const server = app.listen(config.PORT, '0.0.0.0', () => log('info', 'listening', { port: config.PORT, env: config.NODE_ENV, aiMode: config.AI_MODE, mailMode: config.MAIL_MODE }));
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

/**
 * Graceful shutdown: readiness goes red first so a load balancer stops sending traffic, in-flight
 * requests get up to ten seconds to finish, then the worker and the database are closed. A second
 * signal, or the deadline, forces exit.
 */
let stopping = false;
function shutdown(signal: string) {
  if (stopping) {
    log('warn', 'forced exit', { signal });
    process.exit(1);
  }
  stopping = true;
  beginShutdown();
  log('info', 'shutting down', { signal });
  clearInterval(retention);
  clearTimeout(firstRetention);
  stopWorker();
  // Live-update streams never end on their own; end them so the server can close cleanly and each
  // browser reconnects to whatever is serving next.
  const streams = openStreams();
  closeAllStreams();
  if (streams) log('info', 'closed live-update streams', { streams });
  const deadline = setTimeout(() => {
    log('warn', 'shutdown deadline reached; exiting with open connections');
    process.exit(1);
  }, 10_000);
  deadline.unref();
  server.close(() => {
    void db.$disconnect().finally(() => {
      log('info', 'stopped');
      process.exit(0);
    });
  });
  server.closeIdleConnections();
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => shutdown(signal));
process.on('unhandledRejection', (reason) => log('error', 'unhandled rejection', { reason: reason instanceof Error ? reason.message.slice(0, 300) : String(reason).slice(0, 300) }));
