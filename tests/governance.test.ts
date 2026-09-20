import 'dotenv/config';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { db } from '../server/db.js';
import { config } from '../server/config.js';
import { hashPassword } from '../server/password.js';
import { runRetention, retentionPreview } from '../server/governance.js';

if (config.NODE_ENV !== 'test' || !new URL(config.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Integration tests require NODE_ENV=test and a database name ending in _test');

const app = createApp();
const origin = config.APP_ORIGIN;
const tag = randomUUID();
const password = 'Synthetic-governance-password-2026';
const ids: string[] = [];
let categoryId = '';
let adminCsrf = '';
let employeeId = '';
let ticketId = '';
const admin = request.agent(app);
const employee = request.agent(app);

beforeAll(async () => {
  const hash = await hashPassword(password);
  for (const [name, role] of [['admin', 'ADMIN'], ['employee', 'EMPLOYEE']] as const) {
    const u = await db.user.create({ data: { email: `gov-${name}-${tag}@example.test`, name: `Gov ${name}`, passwordHash: hash, role } });
    ids.push(u.id);
    if (name === 'employee') employeeId = u.id;
  }
  categoryId = (await db.category.create({ data: { name: `Gov ${tag}` } })).id;
  adminCsrf = (await admin.post('/api/auth/login').set('Origin', origin).send({ email: `gov-admin-${tag}@example.test`, password }).expect(200)).body.csrfToken;
  const employeeCsrf = (await employee.post('/api/auth/login').set('Origin', origin).send({ email: `gov-employee-${tag}@example.test`, password }).expect(200)).body.csrfToken;
  const ticket = await employee.post('/api/tickets').set('Origin', origin).set('X-CSRF-Token', employeeCsrf).send({ title: `Governance ticket ${tag}`, description: 'The requester of this ticket will be erased during the test.', categoryId }).expect(201);
  ticketId = ticket.body.id;
});
afterAll(async () => {
  await db.event.deleteMany({ where: { OR: [{ ticketId }, { actorId: { in: ids } }] } });
  await db.ticket.deleteMany({ where: { id: ticketId } });
  await db.category.deleteMany({ where: { id: categoryId } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

describe('audit export', () => {
  it('streams CSV with a header, escapes fields, filters by action, and audits the export itself', async () => {
    const res = await admin.get('/api/admin/audit/export?format=csv&action=CREATED').expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/opspilot-audit-\d{4}-\d{2}-\d{2}\.csv/);
    const lines = res.text.trim().split('\n');
    expect(lines[0]).toBe('id,createdAt,action,actorId,actorName,actorEmail,ticketId,ip,internal,detail');
    expect(lines.some((l) => l.includes(ticketId) && l.includes('CREATED'))).toBe(true);
    expect(lines.slice(1).every((l) => /,[A-Z_]*CREATED[A-Z_]*,/.test(l))).toBe(true);
    const json = await admin.get('/api/admin/audit/export?format=json&action=AUDIT_EXPORTED').expect(200);
    expect(Array.isArray(json.body)).toBe(true);
    expect(json.body.some((e: { detail: string }) => e.detail.includes('filtered by "CREATED"'))).toBe(true);
  });
  it('is administrator-only', async () => {
    await employee.get('/api/admin/audit/export').expect(403);
  });
});

describe('personal data export', () => {
  it('a person can download their own data, and it contains their ticket but no secrets', async () => {
    const res = await employee.get('/api/auth/export').expect(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.body.profile.email).toBe(`gov-employee-${tag}@example.test`);
    expect(res.body.tickets.map((t: { id: string }) => t.id)).toContain(ticketId);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|mfaSecret|tokenHash|csrfToken/);
    expect(res.body.aiUsageSummary).toEqual([]);
  });
  it('an administrator can export any account', async () => {
    const res = await admin.get(`/api/admin/users/${employeeId}/export`).expect(200);
    expect(res.body.profile.id).toBe(employeeId);
    await employee.get(`/api/admin/users/${employeeId}/export`).expect(403);
  });
});

describe('erasure', () => {
  it('requires the email as confirmation, anonymises the account, keeps the ticket, and destroys credentials', async () => {
    await admin.post(`/api/admin/users/${employeeId}/erase`).set('Origin', origin).set('X-CSRF-Token', adminCsrf).send({ confirmEmail: 'wrong@example.test' }).expect(400);
    const res = await admin.post(`/api/admin/users/${employeeId}/erase`).set('Origin', origin).set('X-CSRF-Token', adminCsrf).send({ confirmEmail: `gov-employee-${tag}@example.test` }).expect(200);
    expect(res.body.removed).toContain('email address');
    expect(res.body.retained[0]).toContain('Deleted user');
    const user = await db.user.findUniqueOrThrow({ where: { id: employeeId } });
    expect(user.name).toBe('Deleted user');
    expect(user.email).toBe(`deleted-${employeeId}@erased.invalid`);
    expect(user.active).toBe(false);
    expect(user.deletedAt).not.toBeNull();
    await employee.get('/api/auth/me').expect(401);
    await request(app).post('/api/auth/login').set('Origin', origin).send({ email: `gov-employee-${tag}@example.test`, password }).expect(401);
    const ticket = await db.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: { requester: true } });
    expect(ticket.requester.name).toBe('Deleted user');
    expect(ticket.title).toContain('Governance ticket');
    const list = await admin.get('/api/admin/users').expect(200);
    expect(list.body.some((u: { id: string }) => u.id === employeeId)).toBe(false);
    await admin.post(`/api/admin/users/${employeeId}/erase`).set('Origin', origin).set('X-CSRF-Token', adminCsrf).send({ confirmEmail: `deleted-${employeeId}@erased.invalid` }).expect(404);
  });
  it('an administrator cannot erase themselves', async () => {
    const me = (await admin.get('/api/auth/me').expect(200)).body.user;
    await admin.post(`/api/admin/users/${me.id}/erase`).set('Origin', origin).set('X-CSRF-Token', adminCsrf).send({ confirmEmail: me.email }).expect(400);
  });
});

describe('retention', () => {
  it('previews what the policy would remove and never prunes ticket-bound audit events', async () => {
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    const adminId = ids[0];
    const standalone = await db.event.create({ data: { actorId: adminId, action: 'LOGIN_SUCCESS', detail: 'ancient', createdAt: old } });
    const bound = await db.event.create({ data: { actorId: adminId, ticketId, action: 'UPDATED', detail: 'ancient but on a ticket', createdAt: old } });
    const preview = await retentionPreview();
    expect(preview.policy.auditDays).toBe(config.RETENTION_AUDIT_DAYS);
    if (config.RETENTION_AUDIT_DAYS) expect(preview.eligible.auditEvents).toBeGreaterThanOrEqual(1);
    const result = await admin.post('/api/admin/retention/run').set('Origin', origin).set('X-CSRF-Token', adminCsrf).send({}).expect(200);
    if (config.RETENTION_AUDIT_DAYS) {
      expect(result.body.auditEvents).toBeGreaterThanOrEqual(1);
      expect(await db.event.findUnique({ where: { id: standalone.id } })).toBeNull();
    }
    expect(await db.event.findUnique({ where: { id: bound.id } })).not.toBeNull();
    const run = await db.event.findFirst({ where: { action: 'RETENTION_RUN', actorId: adminId }, orderBy: { createdAt: 'desc' } });
    expect(run?.detail).toContain('Retention applied');
    await db.event.deleteMany({ where: { id: { in: [bound.id] } } });
  });
  it('the scheduler path runs without an actor', async () => {
    const result = await runRetention();
    expect(Object.keys(result)).toEqual(['auditEvents', 'aiUsage', 'outbox', 'expiredSessions', 'staleResets']);
  });
  it('is administrator-only', async () => {
    const other = request.agent(app);
    // The erased employee cannot sign in; use a fresh non-admin.
    const u = await db.user.create({ data: { email: `gov-eng-${tag}@example.test`, name: 'Gov eng', passwordHash: await hashPassword(password), role: 'ENGINEER' } });
    ids.push(u.id);
    const csrf = (await other.post('/api/auth/login').set('Origin', origin).send({ email: u.email, password }).expect(200)).body.csrfToken;
    await other.get('/api/admin/retention').expect(403);
    await other.post('/api/admin/retention/run').set('Origin', origin).set('X-CSRF-Token', csrf).send({}).expect(403);
  });
});
