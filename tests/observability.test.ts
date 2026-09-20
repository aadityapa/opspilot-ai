import 'dotenv/config';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { db } from '../server/db.js';
import { config } from '../server/config.js';
import { hashPassword } from '../server/password.js';
import { renderMetrics } from '../server/observability.js';

if (config.NODE_ENV !== 'test' || !new URL(config.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Integration tests require NODE_ENV=test and a database name ending in _test');

const app = createApp();
const origin = config.APP_ORIGIN;
const tag = randomUUID();
let userId = '';

beforeAll(async () => {
  userId = (await db.user.create({ data: { email: `obs-${tag}@example.test`, name: 'Obs', passwordHash: await hashPassword('Synthetic-obs-password-2026'), role: 'EMPLOYEE' } })).id;
});
afterAll(async () => {
  await db.event.deleteMany({ where: { actorId: userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

describe('health probes', () => {
  it('liveness never touches the database and readiness reports each check', async () => {
    const live = await request(app).get('/api/health/live').expect(200);
    expect(live.body.status).toBe('ok');
    expect(typeof live.body.uptimeSeconds).toBe('number');
    const ready = await request(app).get('/api/health/ready').expect(200);
    expect(ready.body).toEqual({ status: 'ready', checks: { notShuttingDown: 'ok', database: 'ok', migrations: 'ok' } });
    const legacy = await request(app).get('/api/health').expect(200);
    expect(legacy.body).toEqual({ status: 'ok' });
  });
});

describe('request correlation', () => {
  it('returns a request id on every response and honours a well-formed one from the client', async () => {
    const generated = await request(app).get('/api/health/live').expect(200);
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const supplied = await request(app).get('/api/health/live').set('X-Request-Id', 'trace-abc-123').expect(200);
    expect(supplied.headers['x-request-id']).toBe('trace-abc-123');
    const hostile = await request(app).get('/api/health/live').set('X-Request-Id', '<script>alert(1)</script>').expect(200);
    expect(hostile.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('metrics', () => {
  it('is hidden without a token, refuses a wrong one, and serves Prometheus text with the right one', async () => {
    expect(config.METRICS_TOKEN).toBeTruthy();
    await request(app).get('/metrics').expect(401);
    await request(app).get('/metrics').set('Authorization', 'Bearer wrong').expect(401);
    const res = await request(app).get('/metrics').set('Authorization', `Bearer ${config.METRICS_TOKEN}`).expect(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('# TYPE http_requests_total counter');
    expect(res.text).toContain('# TYPE http_request_duration_seconds histogram');
    expect(res.text).toMatch(/http_requests_total\{method="GET",route="\/api\/health\/live",status_class="2xx"\} \d+/);
    expect(res.text).toMatch(/opspilot_tickets_open \d+/);
    expect(res.text).toMatch(/opspilot_sessions_active \d+/);
    expect(res.text).toMatch(/process_resident_memory_bytes \d+/);
  });
  it('collapses record identifiers so one route is one label', async () => {
    await request(app).get(`/api/tickets/${randomUUID()}`).expect(401);
    await request(app).get(`/api/tickets/${randomUUID()}`).expect(401);
    const text = renderMetrics();
    const match = text.match(/http_requests_total\{method="GET",route="\/api\/tickets\/:id",status_class="4xx"\} (\d+)/);
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(2);
    expect(text).not.toMatch(/route="\/api\/tickets\/[0-9a-f]{8}-/);
  });
});

describe('request logging', () => {
  it('writes one JSON line per API request with no body, query or cookie content', async () => {
    const lines: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await request(app).post('/api/auth/login').set('Origin', origin).set('X-Request-Id', 'log-line-test-0001').send({ email: `obs-${tag}@example.test`, password: 'definitely-not-it' }).expect(401);
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      process.stdout.write = original;
    }
    const line = lines.map((l) => l.trim()).find((l) => l.includes('log-line-test-0001'));
    expect(line, 'a log line for the request').toBeTruthy();
    const parsed = JSON.parse(line!);
    expect(parsed).toMatchObject({ level: 'info', message: 'request', method: 'POST', route: '/api/auth/login', status: 401, requestId: 'log-line-test-0001' });
    expect(typeof parsed.durationMs).toBe('number');
    expect(line).not.toContain('definitely-not-it');
    expect(line).not.toContain(`obs-${tag}@example.test`);
    expect(line).not.toMatch(/cookie|password/i);
  });
});
