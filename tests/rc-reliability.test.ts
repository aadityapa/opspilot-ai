import 'dotenv/config';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { db } from '../server/db.js';
import { config } from '../server/config.js';
import { hashPassword } from '../server/password.js';
import { slaPosition, atRiskShare, type Clock } from '../server/sla.js';

if (config.NODE_ENV !== 'test' || !new URL(config.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Integration tests require NODE_ENV=test and a database name ending in _test');

/**
 * Release-candidate reliability: two people acting on one record at once, and the single SLA
 * definition at its boundaries. Every clock reading is injected; nothing here waits on real time.
 */
class TestClock implements Clock {
  constructor(private current: Date) {}
  now() { return new Date(this.current); }
  set(iso: string) { this.current = new Date(iso); }
  advanceMinutes(m: number) { this.current = new Date(this.current.getTime() + m * 60000); }
}
const clock = new TestClock(new Date('2026-09-14T09:00:00.000Z'));
const app = createApp(clock);
const origin = config.APP_ORIGIN;
const tag = randomUUID();
const password = 'Synthetic-rc-reliability-password-2026';
const agents = { employee: request.agent(app), manager: request.agent(app), a: request.agent(app), b: request.agent(app), admin: request.agent(app) };
type Who = keyof typeof agents;
const csrf: Record<string, string> = {};
const userId: Record<string, string> = {};
const ids: string[] = [];
let categoryId = '';
let departmentId = '';
const post = (who: Who, path: string, body: unknown) => agents[who].post(`/api${path}`).set('Origin', origin).set('X-CSRF-Token', csrf[who]).send(body as object);
const patch = (who: Who, path: string, body: unknown) => agents[who].patch(`/api${path}`).set('Origin', origin).set('X-CSRF-Token', csrf[who]).send(body as object);
const create = async (extra: Record<string, unknown> = {}) => (await post('employee', '/tickets', { title: `Rc rel ${tag} ${Math.random().toString(36).slice(2, 7)}`, description: 'A synthetic ticket for the reliability suite, long enough to pass validation.', categoryId, ...extra }).expect(201)).body;

beforeAll(async () => {
  const hash = await hashPassword(password);
  for (const [name, role] of [['employee', 'EMPLOYEE'], ['manager', 'EMPLOYEE'], ['a', 'ENGINEER'], ['b', 'ENGINEER'], ['admin', 'ADMIN']] as const) {
    const u = await db.user.create({ data: { email: `rcr-${name}-${tag}@example.test`, name: `Rcr ${name}`, passwordHash: hash, role } });
    ids.push(u.id); userId[name] = u.id;
    csrf[name] = (await agents[name].post('/api/auth/login').set('Origin', origin).send({ email: u.email, password }).expect(200)).body.csrfToken;
  }
  categoryId = (await db.category.create({ data: { name: `Rcr ${tag}` } })).id;
  departmentId = (await db.department.create({ data: { name: `Rcr dept ${tag}`, code: `Q${tag.slice(0, 6).toUpperCase()}`, managerId: userId.manager } })).id;
  await db.user.update({ where: { id: userId.employee }, data: { departmentId, managerId: userId.manager } });
});
afterAll(async () => {
  const mine = (await db.ticket.findMany({ where: { requesterId: { in: ids } }, select: { id: true } })).map((t) => t.id);
  await db.approval.deleteMany({ where: { ticketId: { in: mine } } });
  await db.reply.deleteMany({ where: { ticketId: { in: mine } } });
  await db.event.deleteMany({ where: { OR: [{ ticketId: { in: mine } }, { actorId: { in: ids } }] } });
  await db.outbox.deleteMany({ where: { ticketId: { in: mine } } });
  await db.watcher.deleteMany({ where: { ticketId: { in: mine } } });
  await db.ticketSla.deleteMany({ where: { ticketId: { in: mine } } });
  await db.ticket.deleteMany({ where: { id: { in: mine } } });
  await db.catalogItem.deleteMany({ where: { name: { contains: tag } } });
  await db.user.updateMany({ where: { id: { in: ids } }, data: { departmentId: null, managerId: null } });
  await db.category.deleteMany({ where: { id: categoryId } });
  await db.department.deleteMany({ where: { id: departmentId } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

describe('concurrent updates', () => {
  it('two agents editing the same ticket: the second write is refused with 409 and nothing is overwritten', async () => {
    const t = await create();
    const [first, second] = await Promise.all([
      patch('a', `/tickets/${t.id}`, { version: t.version, priority: 'HIGH' }),
      patch('b', `/tickets/${t.id}`, { version: t.version, priority: 'LOW' }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    const winner = first.status === 200 ? first : second;
    const stored = await db.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(stored.priority).toBe(winner.body.priority);
    expect(stored.version).toBe(t.version + 1);
    const loser = first.status === 409 ? first : second;
    expect(loser.body.error).toMatch(/changed|refresh/i);
  });
  it('a reply arriving after another agent resolved the ticket is refused, not silently attached', async () => {
    const t = await create();
    await patch('a', `/tickets/${t.id}`, { version: t.version, status: 'IN_PROGRESS', assigneeId: userId.a }).expect(200);
    const fresh = await agents.a.get(`/api/tickets/${t.id}`).expect(200);
    await patch('a', `/tickets/${t.id}`, { version: fresh.body.version, status: 'RESOLVED' }).expect(200);
    const late = await post('b', `/tickets/${t.id}/replies`, { body: 'Written while the ticket was still open, sent after it was resolved.' });
    expect(late.status).toBe(409);
    expect(late.body.error).toMatch(/reopen/i);
    expect(await db.reply.count({ where: { ticketId: t.id } })).toBe(0);
  });
  it('an approval can be decided once; a racing second decision gets 409 and the outcome is the first one', async () => {
    const item = await db.catalogItem.create({ data: { name: `Rcr item ${tag}`, description: 'Synthetic approval-routed item.', categoryId, fields: [], type: 'REQUEST', priority: 'MEDIUM', requiresApproval: true, approverKind: 'MANAGER' } });
    const t = await create({ catalogItemId: item.id, formData: {} });
    const approval = t.approvals[0];
    expect(approval.approver.id).toBe(userId.manager);
    const [x, y] = await Promise.all([
      post('manager', `/tickets/${t.id}/approvals/${approval.id}/decide`, { decision: 'APPROVED' }),
      post('admin', `/tickets/${t.id}/approvals/${approval.id}/decide`, { decision: 'REJECTED' }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const stored = await db.approval.findUniqueOrThrow({ where: { id: approval.id } });
    expect(stored.status).toBe(x.status === 200 ? 'APPROVED' : 'REJECTED');
  });
  it('a board move that the workflow forbids is refused and the card stays where it was', async () => {
    const t = await create();
    const r = await post('a', '/board/move', { id: t.id, status: 'CLOSED', afterId: null });
    expect(r.status).toBe(409);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('OPEN');
  });
  it('a bulk action skips what it cannot change and says why, instead of failing the whole batch', async () => {
    const open = await create();
    const t = await create();
    await patch('a', `/tickets/${t.id}`, { version: t.version, status: 'IN_PROGRESS', assigneeId: userId.a }).expect(200);
    const fresh = await agents.a.get(`/api/tickets/${t.id}`).expect(200);
    await patch('a', `/tickets/${t.id}`, { version: fresh.body.version, status: 'RESOLVED' }).expect(200);
    const r = await post('a', '/tickets/bulk', { ids: [open.id, t.id], status: 'IN_PROGRESS' }).expect(200);
    expect(r.body.updated).toBe(1);
    expect(r.body.skipped).toHaveLength(1);
    expect(r.body.skipped[0].id).toBe(t.id);
  });
});

describe('the single SLA definition at its boundaries (injected clock)', () => {
  it('healthy → at risk → breached → met, and paused while waiting, all from slaPosition', async () => {
    const policy = await db.slaPolicy.findUniqueOrThrow({ where: { priority: 'HIGH' } });
    clock.set('2026-09-14T09:00:00.000Z');
    const t = await create({ priority: 'HIGH' });
    const load = async () => db.ticket.findUniqueOrThrow({ where: { id: t.id }, include: { sla: true } });
    // Just created: both budgets full.
    let p = slaPosition(await load(), clock.now());
    expect(p).toMatchObject({ breached: false, atRisk: false });
    // Response budget: one minute above the at-risk share is still healthy; exactly at the share is at risk.
    const share = Math.floor(policy.responseMinutes * atRiskShare);
    clock.advanceMinutes(policy.responseMinutes - share - 1);
    expect(slaPosition(await load(), clock.now()).atRisk).toBe(false);
    clock.advanceMinutes(1);
    p = slaPosition(await load(), clock.now());
    expect(p.atRisk).toBe(true);
    expect(p.breached).toBe(false);
    expect(p.remainingMs).toBe(share * 60000);
    // One millisecond past the response deadline is breached, with the deadline as the breach time.
    clock.set(new Date(Date.parse('2026-09-14T09:00:00.000Z') + policy.responseMinutes * 60000 + 1).toISOString());
    p = slaPosition(await load(), clock.now());
    expect(p.breached).toBe(true);
    expect(p.breachedAt?.toISOString()).toBe(new Date(Date.parse('2026-09-14T09:00:00.000Z') + policy.responseMinutes * 60000).toISOString());
    // A public reply from an engineer satisfies the response target; the resolution clock keeps running.
    const t2 = await create({ priority: 'HIGH' });
    clock.set('2026-09-14T10:00:00.000Z');
    await patch('a', `/tickets/${t2.id}`, { version: t2.version, status: 'IN_PROGRESS', assigneeId: userId.a }).expect(200);
    await post('a', `/tickets/${t2.id}/replies`, { body: 'Looking into this now.' }).expect(201);
    const load2 = async () => db.ticket.findUniqueOrThrow({ where: { id: t2.id }, include: { sla: true } });
    expect((await load2()).sla!.responseSatisfiedAt).not.toBeNull();
    // Waiting for the requester pauses resolution: time passing changes nothing.
    const v = (await agents.a.get(`/api/tickets/${t2.id}`).expect(200)).body.version;
    await patch('a', `/tickets/${t2.id}`, { version: v, status: 'WAITING_FOR_USER' }).expect(200);
    const before = slaPosition(await load2(), clock.now());
    clock.advanceMinutes(policy.resolutionMinutes * 2);
    const after = slaPosition(await load2(), clock.now());
    expect(after).toEqual(before);
    expect(after.breached).toBe(false);
    // Resumed by the requester's reply, then resolved inside the budget: met.
    await post('employee', `/tickets/${t2.id}/replies`, { body: 'Here is the information you asked for.' }).expect(201);
    clock.advanceMinutes(30);
    const v2 = (await agents.a.get(`/api/tickets/${t2.id}`).expect(200)).body.version;
    await patch('a', `/tickets/${t2.id}`, { version: v2, status: 'RESOLVED' }).expect(200);
    const done = await load2();
    expect(done.sla!.resolutionBreachAt).toBeNull();
    expect(slaPosition(done, clock.now())).toEqual({ breached: false, atRisk: false, remainingMs: null, breachedAt: null });
    // And the list filter, the operations summary and analytics all read the same function.
    clock.set('2026-09-14T09:00:00.000Z');
    const breachedList = await agents.a.get('/api/tickets?sla=breached&pageSize=100').expect(200);
    expect(breachedList.body.items.some((x: { id: string }) => x.id === t.id)).toBe(false);
    clock.set('2026-09-15T09:00:00.000Z');
    const later = await agents.a.get('/api/tickets?sla=breached&pageSize=100').expect(200);
    expect(later.body.items.some((x: { id: string }) => x.id === t.id)).toBe(true);
  });
});
