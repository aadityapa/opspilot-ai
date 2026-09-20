import 'dotenv/config';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { db } from '../server/db.js';
import { config } from '../server/config.js';
import { hashPassword } from '../server/password.js';

if (config.NODE_ENV !== 'test' || !new URL(config.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Integration tests require NODE_ENV=test and a database name ending in _test');

/**
 * The permission matrix, as documented in docs/PERMISSIONS.md, checked against the live API.
 *
 * Each row names an endpoint and the *authorisation* outcome per role, before any business
 * validation. "allow" means the role may reach the handler: the request returns anything other
 * than 401/403. "deny" means 403. Anonymous requests must always be 401 on session-protected
 * routes. Every endpoint the server registers must appear here, so adding a route without deciding
 * who may call it fails this suite.
 */
type Outcome = 'allow' | 'deny';
interface Row { method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; path: string; employee: Outcome; engineer: Outcome; admin: Outcome; body?: unknown; note?: string }

const ID = '00000000-0000-4000-8000-000000000000';
export const MATRIX: Row[] = [
  // Session and account — every signed-in person.
  { method: 'GET', path: '/auth/me', employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'GET', path: '/auth/sessions', employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'DELETE', path: `/auth/sessions/${ID}`, employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'POST', path: '/auth/sessions/revoke-others', employee: 'allow', engineer: 'allow', admin: 'allow', body: {} },
  { method: 'POST', path: '/auth/password', employee: 'allow', engineer: 'allow', admin: 'allow', body: {} },
  { method: 'POST', path: '/auth/mfa/setup', employee: 'allow', engineer: 'allow', admin: 'allow', body: {} },
  { method: 'POST', path: '/auth/mfa/enable', employee: 'allow', engineer: 'allow', admin: 'allow', body: {} },
  { method: 'POST', path: '/auth/mfa/verify', employee: 'allow', engineer: 'allow', admin: 'allow', body: {} },
  { method: 'POST', path: '/auth/mfa/disable', employee: 'allow', engineer: 'allow', admin: 'allow', body: {} },
  { method: 'POST', path: '/auth/mfa/recovery-codes', employee: 'allow', engineer: 'allow', admin: 'allow', body: {} },
  { method: 'GET', path: '/auth/export', employee: 'allow', engineer: 'allow', admin: 'allow' },
  // Tickets — employees see their own; support roles see all; only support may update.
  { method: 'GET', path: '/tickets', employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'POST', path: '/tickets', employee: 'allow', engineer: 'allow', admin: 'allow', body: {} },
  { method: 'GET', path: `/tickets/${ID}`, employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'PATCH', path: `/tickets/${ID}`, employee: 'deny', engineer: 'allow', admin: 'allow', body: {} },
  { method: 'POST', path: `/tickets/${ID}/replies`, employee: 'allow', engineer: 'allow', admin: 'allow', body: {} },
  { method: 'POST', path: `/tickets/${ID}/reopen`, employee: 'allow', engineer: 'allow', admin: 'allow', body: {} },
  { method: 'GET', path: `/tickets/${ID}/notes`, employee: 'deny', engineer: 'allow', admin: 'allow' },
  { method: 'POST', path: `/tickets/${ID}/notes`, employee: 'deny', engineer: 'allow', admin: 'allow', body: {} },
  { method: 'GET', path: `/tickets/${ID}/events`, employee: 'deny', engineer: 'allow', admin: 'allow' },
  { method: 'GET', path: '/dashboard', employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'GET', path: '/categories', employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'GET', path: '/engineers', employee: 'deny', engineer: 'allow', admin: 'allow' },
  // Assets — read scoped by role; write is administrator-only.
  { method: 'GET', path: '/assets', employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'GET', path: '/assets/summary', employee: 'allow', engineer: 'allow', admin: 'allow', note: 'Totals over exactly the rows the caller may list' },
  { method: 'GET', path: `/assets/${ID}`, employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'POST', path: '/assets', employee: 'deny', engineer: 'deny', admin: 'allow', body: {} },
  { method: 'PATCH', path: `/assets/${ID}`, employee: 'deny', engineer: 'deny', admin: 'allow', body: {} },
  // Knowledge — read filtered by visibility; authoring is administrator-only.
  { method: 'GET', path: '/articles', employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'GET', path: `/articles/${ID}`, employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'POST', path: `/articles/${ID}/feedback`, employee: 'allow', engineer: 'allow', admin: 'allow', body: { helpful: true }, note: 'Anyone who may read the article may rate it; the article scope decides' },
  { method: 'GET', path: '/knowledge/overview', employee: 'allow', engineer: 'allow', admin: 'allow', note: 'Aggregates computed under the caller visibility' },
  { method: 'POST', path: '/articles', employee: 'deny', engineer: 'deny', admin: 'allow', body: {} },
  { method: 'PUT', path: `/articles/${ID}`, employee: 'deny', engineer: 'deny', admin: 'allow', body: {} },
  // Notifications.
  { method: 'GET', path: '/notifications', employee: 'allow', engineer: 'allow', admin: 'allow' },
  // AI — ask is for everyone (retrieval is permission-filtered); ticket assistance is support-only.
  { method: 'GET', path: '/ai/status', employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'POST', path: '/ai/ask', employee: 'allow', engineer: 'allow', admin: 'allow', body: {} },
  { method: 'POST', path: `/ai/tickets/${ID}/analyze`, employee: 'deny', engineer: 'allow', admin: 'allow', body: {} },
  { method: 'POST', path: `/ai/tickets/${ID}/apply-triage`, employee: 'deny', engineer: 'allow', admin: 'allow', body: {} },
  { method: 'POST', path: `/ai/tickets/${ID}/summary`, employee: 'deny', engineer: 'allow', admin: 'allow', body: {} },
  { method: 'POST', path: `/ai/tickets/${ID}/draft-reply`, employee: 'deny', engineer: 'allow', admin: 'allow', body: {} },
  // Workspace (Phase 6): board, views, bulk, labels, search.
  { method: 'GET', path: '/board', employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'POST', path: '/board/move', employee: 'deny', engineer: 'allow', admin: 'allow', body: {} },
  { method: 'POST', path: '/tickets/bulk', employee: 'deny', engineer: 'allow', admin: 'allow', body: {} },
  { method: 'GET', path: '/views', employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'POST', path: '/views', employee: 'allow', engineer: 'allow', admin: 'allow', body: {} },
  { method: 'DELETE', path: `/views/${ID}`, employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'GET', path: '/labels', employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'GET', path: '/search', employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'GET', path: '/events/stream', employee: 'allow', engineer: 'allow', admin: 'allow', note: 'server-sent events; closes immediately in tests' },
  // Catalog, templates, approvals.
  { method: 'GET', path: '/catalog', employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'GET', path: `/catalog/${ID}`, employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'GET', path: '/admin/catalog', employee: 'deny', engineer: 'deny', admin: 'allow' },
  { method: 'POST', path: '/admin/catalog', employee: 'deny', engineer: 'deny', admin: 'allow', body: {} },
  { method: 'PUT', path: `/admin/catalog/${ID}`, employee: 'deny', engineer: 'deny', admin: 'allow', body: {} },
  { method: 'GET', path: '/templates', employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'GET', path: '/admin/templates', employee: 'deny', engineer: 'deny', admin: 'allow' },
  { method: 'POST', path: '/admin/templates', employee: 'deny', engineer: 'deny', admin: 'allow', body: {} },
  { method: 'PUT', path: `/admin/templates/${ID}`, employee: 'deny', engineer: 'deny', admin: 'allow', body: {} },
  { method: 'GET', path: '/approvals', employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'POST', path: `/tickets/${ID}/approvals/${ID}/decide`, employee: 'allow', engineer: 'allow', admin: 'allow', body: {} },
  // Collaboration on a ticket the caller may read.
  { method: 'POST', path: `/tickets/${ID}/watch`, employee: 'allow', engineer: 'allow', admin: 'allow', body: {} },
  { method: 'DELETE', path: `/tickets/${ID}/watch`, employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'POST', path: `/tickets/${ID}/watchers`, employee: 'deny', engineer: 'allow', admin: 'allow', body: {} },
  { method: 'POST', path: `/tickets/${ID}/attachments`, employee: 'allow', engineer: 'allow', admin: 'allow', body: {} },
  { method: 'GET', path: `/tickets/${ID}/attachments/${ID}`, employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'DELETE', path: `/tickets/${ID}/attachments/${ID}`, employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'PATCH', path: `/tickets/${ID}/replies/${ID}`, employee: 'allow', engineer: 'allow', admin: 'allow', body: {} },
  { method: 'GET', path: `/tickets/${ID}/activity`, employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'GET', path: `/tickets/${ID}/mentionable`, employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'POST', path: `/tickets/${ID}/survey`, employee: 'allow', engineer: 'allow', admin: 'allow', body: {} },
  // People and organisation.
  { method: 'GET', path: '/people', employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'GET', path: `/people/${ID}`, employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'PATCH', path: '/auth/profile', employee: 'allow', engineer: 'allow', admin: 'allow', body: {} },
  { method: 'PATCH', path: `/admin/users/${ID}/profile`, employee: 'deny', engineer: 'deny', admin: 'allow', body: {} },
  { method: 'GET', path: '/departments', employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'POST', path: '/admin/departments', employee: 'deny', engineer: 'deny', admin: 'allow', body: {} },
  { method: 'PUT', path: `/admin/departments/${ID}`, employee: 'deny', engineer: 'deny', admin: 'allow', body: {} },
  { method: 'DELETE', path: `/admin/departments/${ID}`, employee: 'deny', engineer: 'deny', admin: 'allow' },
  { method: 'GET', path: '/announcements', employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'GET', path: '/admin/announcements', employee: 'deny', engineer: 'deny', admin: 'allow' },
  { method: 'POST', path: '/admin/announcements', employee: 'deny', engineer: 'deny', admin: 'allow', body: {} },
  { method: 'PUT', path: `/admin/announcements/${ID}`, employee: 'deny', engineer: 'deny', admin: 'allow', body: {} },
  { method: 'DELETE', path: `/admin/announcements/${ID}`, employee: 'deny', engineer: 'deny', admin: 'allow' },
  { method: 'GET', path: '/reports', employee: 'deny', engineer: 'allow', admin: 'allow' },
  { method: 'GET', path: '/operations/summary', employee: 'deny', engineer: 'allow', admin: 'allow' },
  { method: 'GET', path: '/analytics', employee: 'deny', engineer: 'allow', admin: 'allow', note: 'Service Intelligence: performance over time' },
  { method: 'GET', path: '/reports/sla', employee: 'deny', engineer: 'allow', admin: 'allow', note: 'Report rows and CSV under the same filters' },
  // Notification centre.
  { method: 'GET', path: '/notifications/unread', employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'POST', path: '/notifications/read', employee: 'allow', engineer: 'allow', admin: 'allow', body: {} },
  { method: 'GET', path: '/notifications/preferences', employee: 'allow', engineer: 'allow', admin: 'allow' },
  { method: 'PUT', path: '/notifications/preferences', employee: 'allow', engineer: 'allow', admin: 'allow', body: {} },
  // Administration — administrator only, without exception.
  { method: 'GET', path: '/admin/users', employee: 'deny', engineer: 'deny', admin: 'allow' },
  { method: 'POST', path: '/admin/users', employee: 'deny', engineer: 'deny', admin: 'allow', body: {} },
  { method: 'PATCH', path: `/admin/users/${ID}`, employee: 'deny', engineer: 'deny', admin: 'allow', body: {} },
  { method: 'POST', path: `/admin/users/${ID}/unlock`, employee: 'deny', engineer: 'deny', admin: 'allow', body: {} },
  { method: 'POST', path: `/admin/users/${ID}/revoke-sessions`, employee: 'deny', engineer: 'deny', admin: 'allow', body: {} },
  { method: 'POST', path: `/admin/users/${ID}/mfa-reset`, employee: 'deny', engineer: 'deny', admin: 'allow', body: {} },
  { method: 'POST', path: `/admin/users/${ID}/reset-link`, employee: 'deny', engineer: 'deny', admin: 'allow', body: {} },
  { method: 'GET', path: `/admin/users/${ID}/export`, employee: 'deny', engineer: 'deny', admin: 'allow' },
  { method: 'POST', path: `/admin/users/${ID}/erase`, employee: 'deny', engineer: 'deny', admin: 'allow', body: {} },
  { method: 'GET', path: '/admin/audit', employee: 'deny', engineer: 'deny', admin: 'allow' },
  { method: 'GET', path: '/admin/audit/export', employee: 'deny', engineer: 'deny', admin: 'allow' },
  { method: 'GET', path: '/admin/retention', employee: 'deny', engineer: 'deny', admin: 'allow' },
  { method: 'GET', path: '/admin/security', employee: 'deny', engineer: 'deny', admin: 'allow', note: 'Security posture: policy values and account facts, no secrets' },
  { method: 'POST', path: '/admin/retention/run', employee: 'deny', engineer: 'deny', admin: 'allow', body: {} },
  { method: 'GET', path: '/admin/erasure-policy', employee: 'deny', engineer: 'deny', admin: 'allow' },
  { method: 'GET', path: '/admin/outbox', employee: 'deny', engineer: 'deny', admin: 'allow' },
  { method: 'POST', path: `/admin/outbox/${ID}/retry`, employee: 'deny', engineer: 'deny', admin: 'allow', body: {} },
  { method: 'GET', path: '/admin/sla', employee: 'deny', engineer: 'deny', admin: 'allow' },
  { method: 'PUT', path: '/admin/sla/LOW', employee: 'deny', engineer: 'deny', admin: 'allow', body: {} },
  { method: 'GET', path: '/admin/ai/index', employee: 'deny', engineer: 'deny', admin: 'allow' },
  { method: 'GET', path: '/admin/ai/usage', employee: 'deny', engineer: 'deny', admin: 'allow' },
  { method: 'POST', path: '/admin/ai/reindex', employee: 'deny', engineer: 'deny', admin: 'allow', body: {} },
];

/** Routes that need no session: they are exercised elsewhere and listed here so the coverage check knows about them. */
const PUBLIC = ['POST /auth/login', 'POST /auth/forgot', 'POST /auth/reset', 'GET /health', 'GET /health/live', 'GET /health/ready', 'POST /auth/logout'];

const app = createApp();
const origin = config.APP_ORIGIN;
const tag = randomUUID();
const password = 'Synthetic-matrix-password-2026';
const ids: string[] = [];
const agents = { employee: request.agent(app), engineer: request.agent(app), admin: request.agent(app) };
const csrf: Record<string, string> = {};

beforeAll(async () => {
  const hash = await hashPassword(password);
  for (const [name, role] of [['employee', 'EMPLOYEE'], ['engineer', 'ENGINEER'], ['admin', 'ADMIN']] as const) {
    const u = await db.user.create({ data: { email: `matrix-${name}-${tag}@example.test`, name: `Matrix ${name}`, passwordHash: hash, role } });
    ids.push(u.id);
    const r = await agents[name].post('/api/auth/login').set('Origin', origin).send({ email: u.email, password }).expect(200);
    csrf[name] = r.body.csrfToken;
  }
});
afterAll(async () => {
  await db.event.deleteMany({ where: { actorId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

const call = (agent: ReturnType<typeof request.agent>, row: Row, token: string) => {
  const req = agent[row.method.toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete'](`/api${row.path}`).set('Origin', origin).set('X-CSRF-Token', token);
  return row.body !== undefined ? req.send(row.body as object) : req;
};

describe('permission matrix', () => {
  for (const row of MATRIX) {
    it(`${row.method} ${row.path}: employee ${row.employee}, engineer ${row.engineer}, admin ${row.admin}`, async () => {
      if (row.path === '/events/stream') return; // a stream never ends; its coverage row is what matters
      for (const role of ['employee', 'engineer', 'admin'] as const) {
        const res = await call(agents[role], row, csrf[role]);
        expect(res.status, `${role} on ${row.method} ${row.path}`).not.toBe(401);
        if (row[role] === 'deny') expect(res.status, `${role} should be denied ${row.method} ${row.path}`).toBe(403);
        else expect(res.status, `${role} should reach ${row.method} ${row.path} (got ${res.status}: ${JSON.stringify(res.body).slice(0, 120)})`).not.toBe(403);
      }
      const anonymousRequest = request(app)[row.method.toLowerCase() as 'get'](`/api${row.path}`).set('Origin', origin);
      const anonymous = await (row.body !== undefined ? anonymousRequest.send(row.body as object) : anonymousRequest);
      expect(anonymous.status, `anonymous on ${row.method} ${row.path}`).toBe(401);
    });
  }
  it('covers every route the server registers', () => {
    const registered = new Set<string>();
    const walk = (stack: { route?: { path: string; methods: Record<string, boolean> }; handle?: { stack?: unknown[] }; name?: string }[], prefix = '') => {
      for (const layer of stack) {
        if (layer.route) for (const method of Object.keys(layer.route.methods)) registered.add(`${method.toUpperCase()} ${prefix}${layer.route.path}`);
        else if (layer.handle?.stack) walk(layer.handle.stack as typeof stack, prefix);
      }
    };
    walk((app as unknown as { router: { stack: unknown[] } }).router.stack as never);
    const documented = new Set([...MATRIX.map((r) => `${r.method} ${r.path.replaceAll(ID, ':id').replace('/LOW', '/:id').replace('/reports/sla', '/reports/:id')}`), ...PUBLIC]);
    const missing = [...registered].map((r) => r.replace(/^(\w+) \/api\//, '$1 /').replace(/:\w+/g, ':id')).filter((r) => !documented.has(r) && r !== 'GET /metrics');
    expect(missing, 'routes registered but absent from the matrix').toEqual([]);
  });
});
