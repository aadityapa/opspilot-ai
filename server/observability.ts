/**
 * Operations surface: structured request logs with correlation ids, Prometheus metrics, and the
 * liveness/readiness probes an orchestrator needs. No third-party dependencies.
 *
 * What is deliberately not logged: request bodies, query strings, cookies, headers other than the
 * user agent, and any ticket or article text. A log line identifies *that* a request happened, who
 * made it, and how it went — enough to correlate, never enough to reconstruct.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';

declare global {
  namespace Express {
    interface Locals {
      requestId: string;
    }
  }
}

/* ── Logging ────────────────────────────────────────────────────────────── */

type Level = 'debug' | 'info' | 'warn' | 'error';

export function log(level: Level, message: string, fields: Record<string, unknown> = {}) {
  if (config.LOG_FORMAT === 'off') return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, message, ...fields });
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export function logError(err: unknown, requestId?: string) {
  const error = err instanceof Error ? err : new Error(String(err));
  log('error', 'Unhandled request error', {
    requestId,
    errorName: error.name,
    errorMessage: error.message.slice(0, 300),
    ...(config.NODE_ENV === 'production' ? {} : { stack: error.stack?.split('\n').slice(0, 6).join('\n') }),
  });
}

/** Collapses identifiers so one route produces one label rather than one per record. */
const routeOf = (path: string) =>
  path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id').replace(/\/\d+(?=\/|$)/g, '/:n').slice(0, 120);

const REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const supplied = req.get('x-request-id');
  const requestId = supplied && REQUEST_ID.test(supplied) ? supplied : randomUUID();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    // req.path is rewritten as routers mount and unmount; originalUrl is what the client asked for.
    const path = req.originalUrl.split('?')[0];
    const route = routeOf(path);
    observe(req.method, route, res.statusCode, durationMs);
    if (!path.startsWith('/api') && path !== '/metrics') return; // static assets are noise
    log(res.statusCode >= 500 ? 'error' : 'info', 'request', {
      requestId,
      method: req.method,
      route,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      ip: (req.ip ?? '').replace(/^::ffff:/, '') || undefined,
      userId: res.locals.user?.id,
      userAgent: (req.get('user-agent') ?? '').slice(0, 120) || undefined,
    });
  });
  next();
}

/* ── Metrics ────────────────────────────────────────────────────────────── */

const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const counters = new Map<string, number>();
const histograms = new Map<string, { buckets: number[]; sum: number; count: number }>();
const startedAt = Date.now();

function observe(method: string, route: string, status: number, durationMs: number) {
  const statusClass = `${Math.floor(status / 100)}xx`;
  const key = `${method}|${route}|${statusClass}`;
  counters.set(key, (counters.get(key) ?? 0) + 1);
  const hkey = `${method}|${route}`;
  const h = histograms.get(hkey) ?? { buckets: new Array(BUCKETS.length).fill(0), sum: 0, count: 0 };
  const seconds = durationMs / 1000;
  BUCKETS.forEach((bound, i) => {
    if (seconds <= bound) h.buckets[i] += 1;
  });
  h.sum += seconds;
  h.count += 1;
  histograms.set(hkey, h);
}

const escape = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

let gaugeCache: { at: number; text: string } | null = null;

/** Application gauges come from the database, cached for fifteen seconds so a scrape cannot become a load. */
async function applicationGauges() {
  if (gaugeCache && Date.now() - gaugeCache.at < 15_000) return gaugeCache.text;
  const [open, breached, pendingMail, failedMail, users, sessions] = await Promise.all([
    db.ticket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER'] } } }),
    db.ticketSla.count({ where: { OR: [{ responseBreachAt: { not: null } }, { resolutionBreachAt: { not: null } }], ticket: { status: { notIn: ['RESOLVED', 'CLOSED'] } } } }),
    db.outbox.count({ where: { status: 'PENDING' } }),
    db.outbox.count({ where: { status: 'FAILED' } }),
    db.user.count({ where: { active: true, deletedAt: null } }),
    db.session.count({ where: { expiresAt: { gt: new Date() }, mfaPending: false } }),
  ]);
  const text = [
    '# HELP opspilot_tickets_open Tickets not yet resolved or closed.',
    '# TYPE opspilot_tickets_open gauge',
    `opspilot_tickets_open ${open}`,
    '# HELP opspilot_tickets_sla_breached Unresolved tickets with a breached SLA deadline.',
    '# TYPE opspilot_tickets_sla_breached gauge',
    `opspilot_tickets_sla_breached ${breached}`,
    '# HELP opspilot_outbox_pending Notifications waiting for delivery.',
    '# TYPE opspilot_outbox_pending gauge',
    `opspilot_outbox_pending ${pendingMail}`,
    '# HELP opspilot_outbox_failed Notifications that exhausted their retries.',
    '# TYPE opspilot_outbox_failed gauge',
    `opspilot_outbox_failed ${failedMail}`,
    '# HELP opspilot_users_active Active, non-deleted accounts.',
    '# TYPE opspilot_users_active gauge',
    `opspilot_users_active ${users}`,
    '# HELP opspilot_sessions_active Verified sessions that have not expired.',
    '# TYPE opspilot_sessions_active gauge',
    `opspilot_sessions_active ${sessions}`,
  ].join('\n');
  gaugeCache = { at: Date.now(), text };
  return text;
}

export function renderMetrics() {
  const lines: string[] = [];
  lines.push('# HELP http_requests_total Requests handled, by method, route and status class.', '# TYPE http_requests_total counter');
  for (const [key, value] of counters) {
    const [method, route, statusClass] = key.split('|');
    lines.push(`http_requests_total{method="${method}",route="${escape(route)}",status_class="${statusClass}"} ${value}`);
  }
  lines.push('# HELP http_request_duration_seconds Request latency.', '# TYPE http_request_duration_seconds histogram');
  for (const [key, h] of histograms) {
    const [method, route] = key.split('|');
    const labels = `method="${method}",route="${escape(route)}"`;
    BUCKETS.forEach((bound, i) => lines.push(`http_request_duration_seconds_bucket{${labels},le="${bound}"} ${h.buckets[i]}`));
    lines.push(`http_request_duration_seconds_bucket{${labels},le="+Inf"} ${h.count}`);
    lines.push(`http_request_duration_seconds_sum{${labels}} ${h.sum.toFixed(6)}`);
    lines.push(`http_request_duration_seconds_count{${labels}} ${h.count}`);
  }
  const memory = process.memoryUsage();
  lines.push(
    '# HELP process_uptime_seconds Seconds since the process started.', '# TYPE process_uptime_seconds gauge', `process_uptime_seconds ${Math.floor((Date.now() - startedAt) / 1000)}`,
    '# HELP process_resident_memory_bytes Resident set size.', '# TYPE process_resident_memory_bytes gauge', `process_resident_memory_bytes ${memory.rss}`,
    '# HELP nodejs_heap_used_bytes V8 heap in use.', '# TYPE nodejs_heap_used_bytes gauge', `nodejs_heap_used_bytes ${memory.heapUsed}`,
  );
  return lines.join('\n');
}

export const metricsRouter = Router();
metricsRouter.get('/metrics', async (req, res) => {
  if (!config.METRICS_TOKEN) return res.status(404).end();
  const header = req.get('authorization') ?? '';
  if (header !== `Bearer ${config.METRICS_TOKEN}`) return res.status(401).set('WWW-Authenticate', 'Bearer').end();
  let gauges = '';
  try {
    gauges = await applicationGauges();
  } catch {
    gauges = '# application gauges unavailable: database query failed';
  }
  res.type('text/plain; version=0.0.4; charset=utf-8').send(`${renderMetrics()}\n${gauges}\n`);
});

/* ── Health ─────────────────────────────────────────────────────────────── */

let shuttingDown = false;
export const beginShutdown = () => {
  shuttingDown = true;
};

export const healthRouter = Router();

/** Compatibility endpoint kept from Phase 1: database reachable → ok. */
healthRouter.get('/health', async (_req, res) => {
  await db.$queryRaw`SELECT 1`;
  res.json({ status: 'ok' });
});

/** Liveness: the process is running and can answer. Never touches the database. */
healthRouter.get('/health/live', (_req, res) => res.json({ status: 'ok', uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) }));

/** Readiness: database reachable, every migration applied, not shutting down. 503 otherwise. */
healthRouter.get('/health/ready', async (_req, res) => {
  const checks: Record<string, 'ok' | 'fail'> = {};
  let ready = !shuttingDown;
  checks.notShuttingDown = shuttingDown ? 'fail' : 'ok';
  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = 'ok';
    const pending = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NULL`;
    checks.migrations = pending[0]?.n === 0 ? 'ok' : 'fail';
    if (pending[0]?.n !== 0) ready = false;
  } catch {
    checks.database = 'fail';
    checks.migrations = 'fail';
    ready = false;
  }
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not ready', checks });
});
