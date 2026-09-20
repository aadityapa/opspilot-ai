import 'dotenv/config';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { db } from '../server/db.js';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/password.js';
import { config } from '../server/config.js';
import type { Clock } from '../server/sla.js';
import type { OperationsSummary } from '../shared/model.js';

if (config.NODE_ENV !== 'test' || !new URL(config.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Dedicated test database required');

/**
 * The command-center summary is counted from stored rows under an injected clock. The clock starts at
 * the real time (ticket `createdAt` comes from the database) and is then advanced deterministically,
 * so ages, at-risk countdowns, flow windows and MTTR are asserted against known offsets. Fixtures are
 * tagged and removed afterwards; the shared database is never reset.
 */
class TestClock implements Clock {
  constructor(private current: Date) {}
  now() { return new Date(this.current); }
  advanceMinutes(minutes: number) { this.current = new Date(this.current.getTime() + minutes * 60000); }
}

const started = new Date();
const clock = new TestClock(started);
const app = createApp(clock);
const origin = config.APP_ORIGIN;
const tag = randomUUID();
const password = 'Synthetic-operations-2026';
const agents = { employee: request.agent(app), engineer: request.agent(app), admin: request.agent(app) };
const csrf: Record<string, string> = {};
const userId: Record<string, string> = {};
const ids: string[] = [];
let categoryId = '';
let departmentId = '';
const tickets: string[] = [];
let responseMinutes = 0; // the URGENT first-response target in this database's policy
let elapsedMinutes = 0; // minutes the test clock has advanced since the urgent ticket was raised

const post = (who: keyof typeof agents, path: string, body: object) => agents[who].post(`/api${path}`).set('Origin', origin).set('X-CSRF-Token', csrf[who]).send(body);
const patch = (who: keyof typeof agents, path: string, body: object) => agents[who].patch(`/api${path}`).set('Origin', origin).set('X-CSRF-Token', csrf[who]).send(body);
const summary = async (who: keyof typeof agents = 'engineer', qs = '') => (await agents[who].get(`/api/operations/summary${qs}`).expect(200)).body as OperationsSummary;
const mine = (s: OperationsSummary) => s.critical.filter((c) => tickets.includes(c.id));

beforeAll(async () => {
  const hash = await hashPassword(password);
  for (const [name, role] of [['employee', 'EMPLOYEE'], ['engineer', 'ENGINEER'], ['admin', 'ADMIN']] as const) {
    const u = await db.user.create({ data: { email: `ops-${name}-${tag}@example.test`, name: `Ops ${name}`, passwordHash: hash, role } });
    ids.push(u.id);
    userId[name] = u.id;
    const r = await agents[name].post('/api/auth/login').set('Origin', origin).send({ email: u.email, password }).expect(200);
    csrf[name] = r.body.csrfToken;
  }
  categoryId = (await db.category.create({ data: { name: `Ops ${tag}` } })).id;
  departmentId = (await db.department.create({ data: { name: `Ops dept ${tag}`, code: `O${tag.slice(0, 6).toUpperCase()}` } })).id;
  await db.user.update({ where: { id: userId.employee }, data: { departmentId } });
});
afterAll(async () => {
  await db.event.deleteMany({ where: { OR: [{ ticketId: { in: tickets } }, { actorId: { in: ids } }] } });
  await db.reply.deleteMany({ where: { ticketId: { in: tickets } } });
  await db.ticketSla.deleteMany({ where: { ticketId: { in: tickets } } });
  await db.ticket.deleteMany({ where: { id: { in: tickets } } });
  await db.category.deleteMany({ where: { id: categoryId } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.department.deleteMany({ where: { id: departmentId } });
  await db.$disconnect();
});

// Raised by the employee (who sits in the fixture department); the impact × urgency matrix sets the priority.
const create = async (priority: 'LOW' | 'URGENT') => {
  const level = priority === 'URGENT' ? 'HIGH' : 'LOW';
  const r = await post('employee', '/tickets', { title: `Ops ${priority} ${tag}`, description: 'A synthetic ticket for the operations summary suite, long enough to validate.', categoryId, impact: level, urgency: level }).expect(201);
  expect(r.body.priority).toBe(priority);
  tickets.push(r.body.id);
  return r.body.id as string;
};

describe('operations summary', () => {
  it('is for support roles only and describes its window', async () => {
    await agents.employee.get('/api/operations/summary').expect(403);
    await request(app).get('/api/operations/summary').expect(401);
    const s = await summary('admin', '?days=14');
    expect(s.window.days).toBe(14);
    expect(s.generatedAt).toBe(started.toISOString());
    expect(new Date(s.window.to).getTime() - new Date(s.window.from).getTime()).toBe(14 * 86_400_000);
    await agents.admin.get('/api/operations/summary?days=0').expect(400);
    await agents.admin.get('/api/operations/summary?days=31').expect(400);
  });

  it('counts unowned work by priority with the age of the oldest, and scopes by department', async () => {
    const urgent = await create('URGENT');
    responseMinutes = (await summary('engineer', `?departmentId=${departmentId}`)).critical.find((c) => c.id === urgent)!.sla!.responseMinutes;
    // Stay well inside the first-response budget (30% of it) so nothing is at risk yet.
    elapsedMinutes = Math.max(1, Math.floor(responseMinutes * 0.3));
    clock.advanceMinutes(elapsedMinutes);
    await create('LOW');
    const s = await summary('engineer', `?departmentId=${departmentId}`);
    expect(s.window.departmentId).toBe(departmentId);
    expect(s.active.total).toBe(2);
    expect(s.active.unassigned).toBe(2);
    expect(s.active.unassignedByPriority.URGENT).toBe(1);
    expect(s.active.unassignedByPriority.LOW).toBe(1);
    expect(s.active.oldestUnassignedAgeMs).toBeGreaterThanOrEqual(elapsedMinutes * 60000);
    expect(s.active.oldestUnassignedAgeMs).toBeLessThan(elapsedMinutes * 60000 + 10000);
    expect(s.active.byType.INCIDENT).toBe(2);
    expect(s.departments.find((d) => d.id === departmentId)).toMatchObject({ active: 2, unassigned: 2, created: 2 });
    // The urgent ticket leads the critical-work table; nothing is breached or at risk yet.
    expect(mine(s)[0].id).toBe(urgent);
    expect(mine(s)[0].position).toMatchObject({ breached: false, atRisk: false });
    expect(mine(s).every((c) => c.priority === 'URGENT' || c.priority === 'HIGH')).toBe(true);
  });

  it('moves a ticket to at-risk, then breached, using the same SLA evaluation as the ticket page', async () => {
    const s0 = await summary('engineer', `?departmentId=${departmentId}`);
    const urgent = mine(s0)[0];
    // Consume 80% of the first-response budget: inside the 25% at-risk share.
    const target = Math.ceil(responseMinutes * 0.8);
    clock.advanceMinutes(target - elapsedMinutes);
    elapsedMinutes = target;
    const s1 = await summary('engineer', `?departmentId=${departmentId}`);
    const row1 = mine(s1).find((c) => c.id === urgent.id)!;
    expect(row1.position.atRisk).toBe(true);
    expect(row1.position.remainingMs).toBeLessThanOrEqual(responseMinutes * 0.25 * 60000);
    expect(s1.sla.atRisk).toBeGreaterThanOrEqual(1);
    expect(s1.sla.atRiskUnder30Min).toBe(row1.position.remainingMs! <= 30 * 60000 ? s1.sla.atRiskUnder30Min : 0);
    // Blow through the response deadline: breached, with the age of the oldest breach reported.
    clock.advanceMinutes(responseMinutes - elapsedMinutes + 5);
    elapsedMinutes = responseMinutes + 5;
    const s2 = await summary('engineer', `?departmentId=${departmentId}`);
    const row2 = mine(s2).find((c) => c.id === urgent.id)!;
    expect(row2.position.breached).toBe(true);
    expect(s2.sla.activeBreached).toBeGreaterThanOrEqual(1);
    expect(s2.sla.oldestBreachAgeMs).toBeGreaterThan(0);
    expect(s2.departments.find((d) => d.id === departmentId)!.breached).toBe(1);
    expect(s2.categories.find((c) => c.id === categoryId)).toMatchObject({ active: 2, unassigned: 2, breached: 1 });
    // Breached work sorts above merely urgent work.
    expect(mine(s2)[0].id).toBe(urgent.id);
    // The Service Desk can filter by the same computed position, with real totals for paging.
    const breachedList = (await agents.engineer.get(`/api/tickets?sla=breached&categoryId=${categoryId}`).expect(200)).body;
    expect(breachedList.total).toBe(1);
    expect(breachedList.items[0].id).toBe(urgent.id);
    const healthyList = (await agents.engineer.get(`/api/tickets?sla=healthy&categoryId=${categoryId}`).expect(200)).body;
    expect(healthyList.items.map((t: { id: string }) => t.id)).not.toContain(urgent.id);
    expect(healthyList.total).toBe(1);
    await agents.engineer.get('/api/tickets?sla=soon').expect(400);
  });

  it('reports flow, MTTR and engineer load from stored rows, and the feed shows the latest events', async () => {
    const s0 = await summary('engineer', `?departmentId=${departmentId}`);
    const target = mine(s0)[0];
    await patch('engineer', `/tickets/${target.id}`, { assigneeId: userId.engineer, version: (await agents.engineer.get(`/api/tickets/${target.id}`)).body.version }).expect(200);
    const version = (await agents.engineer.get(`/api/tickets/${target.id}`)).body.version;
    await patch('engineer', `/tickets/${target.id}`, { status: 'IN_PROGRESS', version }).expect(200);
    const v2 = (await agents.engineer.get(`/api/tickets/${target.id}`)).body.version;
    await patch('engineer', `/tickets/${target.id}`, { status: 'RESOLVED', version: v2 }).expect(200);
    const s = await summary('engineer', `?departmentId=${departmentId}&days=1`);
    expect(s.flow.created).toBe(2);
    expect(s.flow.resolved).toBe(1);
    expect(s.flow.backlogChange).toBe(1);
    expect(s.flow.resolutionRatePercent).toBe(50);
    expect(s.flow.perDay).toHaveLength(1);
    expect(s.flow.perDay[0].created).toBe(2);
    // MTTR is the mean of resolvedAt − createdAt over tickets resolved in the window, in minutes.
    const t = (await agents.engineer.get(`/api/tickets/${target.id}`)).body;
    expect(s.mttrMinutes).toBe(Math.round((new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime()) / 60000));
    expect(s.previousMttrMinutes).toBeNull();
    expect(s.active.total).toBe(1);
    expect(s.engineers.find((e) => e.id === userId.engineer)).toBeUndefined(); // resolved work no longer counts as load
    const latest = s.activity[0];
    expect(latest.ticket?.id).toBe(target.id);
    expect(latest.actor?.id).toBe(userId.engineer);
    expect(latest.detail).toMatch(/RESOLVED/);
    expect(s.activity.length).toBeLessThanOrEqual(20);
    expect(s.assets.linkedToActiveTickets).toBe(0);
  });
});
