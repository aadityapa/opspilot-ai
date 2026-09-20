import 'dotenv/config';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { db } from '../server/db.js';
import { config } from '../server/config.js';
import { hashPassword } from '../server/password.js';
import { newSla } from '../server/sla.js';

if (config.NODE_ENV !== 'test' || !new URL(config.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Integration tests require NODE_ENV=test and a database name ending in _test');

/**
 * Phase 5: Service Intelligence, reports and the security posture. The theme is the same as every
 * other suite — a figure is what the stored rows say, a comparison exists only when both periods
 * do, an export is exactly the filtered table, and nothing crosses a role boundary.
 */
const app = createApp();
const origin = config.APP_ORIGIN;
const tag = randomUUID();
const password = 'Synthetic-intelligence-password-2026';
const agents = { employee: request.agent(app), engineer: request.agent(app), admin: request.agent(app) };
const csrf: Record<string, string> = {};
const userId: Record<string, string> = {};
const ids: string[] = [];
let categoryId = '';
let departmentId = '';
const ticketIds: string[] = [];
const DAY = 86_400_000;

beforeAll(async () => {
  const hash = await hashPassword(password);
  for (const [name, role] of [['employee', 'EMPLOYEE'], ['engineer', 'ENGINEER'], ['admin', 'ADMIN']] as const) {
    const u = await db.user.create({ data: { email: `si-${name}-${tag}@example.test`, name: `Si ${name}`, passwordHash: hash, role } });
    ids.push(u.id); userId[name] = u.id;
    csrf[name] = (await agents[name].post('/api/auth/login').set('Origin', origin).send({ email: u.email, password }).expect(200)).body.csrfToken;
  }
  categoryId = (await db.category.create({ data: { name: `Si ${tag}` } })).id;
  departmentId = (await db.department.create({ data: { name: `Si dept ${tag}`, code: `S${tag.slice(0, 6).toUpperCase()}` } })).id;
  await db.user.update({ where: { id: userId.employee }, data: { departmentId } });
  const now = Date.now();
  // Two resolved inside the last 7 days (one late), one resolved in the 7 days before, one still open.
  const rows: [number, number | null, 'HIGH' | 'MEDIUM'][] = [[2, 1.9, 'HIGH'], [3, 1, 'MEDIUM'], [10, 9.5, 'MEDIUM'], [1, null, 'HIGH']];
  for (const [createdDays, resolvedDays, priority] of rows) {
    const created = new Date(now - createdDays * DAY);
    const resolved = resolvedDays === null ? null : new Date(now - resolvedDays * DAY);
    const t = await db.ticket.create({ data: { title: `Si ticket ${tag} ${createdDays}`, description: 'Synthetic ticket for the intelligence suite, long enough to pass validation.', requesterId: userId.employee, assigneeId: userId.engineer, categoryId, priority, status: resolved ? 'RESOLVED' : 'OPEN', createdAt: created, resolvedAt: resolved, sla: { create: await newSla(db, priority, created) } } });
    if (resolved) await db.ticketSla.update({ where: { ticketId: t.id }, data: { runningSince: null, elapsedMs: resolved.getTime() - created.getTime(), responseSatisfiedAt: new Date(created.getTime() + 10 * 60000) } });
    ticketIds.push(t.id);
  }
  await db.survey.create({ data: { ticketId: ticketIds[1], respondentId: userId.employee, score: 4 } });
});
afterAll(async () => {
  await db.survey.deleteMany({ where: { ticketId: { in: ticketIds } } });
  await db.ticketSla.deleteMany({ where: { ticketId: { in: ticketIds } } });
  await db.event.deleteMany({ where: { OR: [{ ticketId: { in: ticketIds } }, { actorId: { in: ids } }] } });
  await db.ticket.deleteMany({ where: { id: { in: ticketIds } } });
  await db.user.updateMany({ where: { id: { in: ids } }, data: { departmentId: null } });
  await db.category.deleteMany({ where: { id: categoryId } });
  await db.department.deleteMany({ where: { id: departmentId } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

describe('service intelligence', () => {
  it('is for support roles only', async () => {
    await agents.employee.get('/api/analytics?days=7').expect(403);
    await agents.engineer.get('/api/analytics?days=7').expect(200);
  });
  it('counts the window from stored rows and compares it with the period before', async () => {
    const r = await agents.engineer.get(`/api/analytics?days=7&departmentId=${departmentId}`).expect(200);
    const a = r.body;
    expect(a.window.days).toBe(7);
    // Three raised in the last 7 days (2d, 3d, 1d ago); two resolved in it; one resolved in the 7 days before.
    expect(a.headline.resolutionRate.measured).toBe(3);
    expect(a.headline.mttrMinutes.measured).toBe(2);
    expect(a.resolution.previousMttrMinutes).not.toBeNull();
    expect(a.headline.mttrMinutes.delta).not.toBeNull();
    // The HIGH ticket resolved in ~2.4 hours met its 8h target; the MEDIUM one resolved after 2 days missed 24h.
    expect(a.headline.slaCompliance.value).toBe(50);
    expect(a.sla.resolutionBreaches).toBeGreaterThanOrEqual(1);
    expect(a.series).toHaveLength(7);
    expect(a.series.reduce((n: number, d: { created: number }) => n + d.created, 0)).toBe(3);
    // Backlog at the end of the last day counts the still-open ticket.
    expect(a.series[a.series.length - 1].backlog).toBe(1);
    expect(a.resolution.ageDistribution.reduce((n: number, b: { count: number }) => n + b.count, 0)).toBe(1);
    expect(a.csat.responses).toBe(1);
    expect(a.csat.average).toBe(4);
    // The team table is alphabetical and carries no rank.
    expect(a.team.map((t: { name: string }) => t.name)).toEqual([...a.team.map((t: { name: string }) => t.name)].sort((x, y) => x.localeCompare(y)));
    expect(JSON.stringify(a)).not.toMatch(/rank|leaderboard|top performer/i);
  });
  it('reports no comparison when the previous period is empty, rather than inventing one', async () => {
    const r = await agents.engineer.get(`/api/analytics?days=365&departmentId=${departmentId}&priority=HIGH`).expect(200);
    expect(r.body.headline.mttrMinutes.value).not.toBeNull();
    expect(r.body.headline.mttrMinutes.previous).toBeNull();
    expect(r.body.headline.mttrMinutes.delta).toBeNull();
  });
});

describe('reports', () => {
  it('returns rows under the filters, and the CSV is exactly those rows', async () => {
    const json = await agents.engineer.get(`/api/reports/tickets?days=7&departmentId=${departmentId}`).expect(200);
    expect(json.body.rows).toHaveLength(3);
    expect(json.body.columns.map((c: { key: string }) => c.key)).toContain('key');
    const csv = await agents.engineer.get(`/api/reports/tickets?days=7&departmentId=${departmentId}&format=csv`).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(/attachment; filename="opspilot-tickets-7d-/);
    const lines = csv.text.replace(/^﻿/, '').trim().split(/\r?\n/);
    expect(lines).toHaveLength(4);
    expect(lines[0].split(',')[0]).toBe('Ticket');
    expect(lines.slice(1).every((l) => l.startsWith('OPS-'))).toBe(true);
    // A priority filter narrows both the same way.
    const narrowed = await agents.engineer.get(`/api/reports/tickets?days=7&departmentId=${departmentId}&priority=HIGH&format=csv`).expect(200);
    expect(narrowed.text.trim().split(/\r?\n/)).toHaveLength(3);
  });
  it('produces every documented kind and refuses unknown ones and employees', async () => {
    for (const kind of ['tickets', 'sla', 'resolution', 'csat', 'requests', 'departments', 'agents', 'assets']) {
      const r = await agents.admin.get(`/api/reports/${kind}?days=30`).expect(200);
      expect(r.body.kind).toBe(kind);
      expect(Array.isArray(r.body.rows)).toBe(true);
      expect(r.body.summary.length).toBeGreaterThan(0);
    }
    await agents.admin.get('/api/reports/secrets').expect(404);
    await agents.employee.get('/api/reports/tickets').expect(403);
    await agents.employee.get('/api/reports/tickets?format=csv').expect(403);
  });
  it('escapes commas and quotes in CSV fields', async () => {
    const t = await db.ticket.create({ data: { title: `Si "quoted", comma ${tag}`, description: 'Synthetic ticket with awkward characters in its title, long enough to validate.', requesterId: userId.employee, categoryId, sla: { create: await newSla(db, 'LOW', new Date()) } } });
    ticketIds.push(t.id);
    const csv = await agents.engineer.get(`/api/reports/tickets?days=7&departmentId=${departmentId}&format=csv`).expect(200);
    expect(csv.text).toContain(`"Si ""quoted"", comma ${tag}"`);
  });
});

describe('security posture', () => {
  it('is administrator-only and never includes a secret', async () => {
    await agents.engineer.get('/api/admin/security').expect(403);
    const r = await agents.admin.get('/api/admin/security').expect(200);
    expect(r.body.policy.sessionHours).toBeGreaterThan(0);
    expect(r.body.policy.lockoutThreshold).toBeGreaterThan(0);
    expect(r.body.accounts.total).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(r.body)).not.toMatch(/secret|passwordHash|APP_SECRET|OPENAI|DATABASE_URL/i);
  });
});

describe('search ranking', () => {
  it('puts an exact ticket key first, however it is typed', async () => {
    const t = await db.ticket.findUnique({ where: { id: ticketIds[0] }, select: { number: true } });
    for (const q of [`OPS-${String(t!.number).padStart(4, '0')}`, `ops ${t!.number}`, String(t!.number)]) {
      const r = await agents.engineer.get(`/api/search?q=${encodeURIComponent(q)}`).expect(200);
      expect(r.body.tickets[0]?.number).toBe(t!.number);
    }
  });
});
