import 'dotenv/config';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { db } from '../server/db.js';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/password.js';
import { config } from '../server/config.js';
import { slaMetrics, type Clock } from '../server/sla.js';
import type { SlaView, Ticket } from '../shared/model.js';

if (config.NODE_ENV !== 'test' || !new URL(config.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Dedicated test database required');

/** Controllable clock. Every SLA timestamp the API writes or reads comes from here, never from Date.now(). */
class TestClock implements Clock {
  constructor(private current: Date) {}
  now() {
    return new Date(this.current);
  }
  advanceMinutes(minutes: number) {
    this.current = new Date(this.current.getTime() + minutes * 60000);
  }
}

const clock = new TestClock(new Date('2026-09-08T00:00:00.000Z'));
const app = createApp(clock);
const origin = config.APP_ORIGIN;
const tag = randomUUID();
const password = 'Synthetic-sla-clock-2026';
const agents = [request.agent(app), request.agent(app), request.agent(app)]; // employee, engineer, admin
const ids: string[] = [];
const tokens: string[] = [];
let categoryId = '';
let ticketId = '';
let snapshot: { responseMinutes: number; resolutionMinutes: number } = {
  responseMinutes: 0,
  resolutionMinutes: 0,
};

const post = (i: number, path: string, body: object) =>
  agents[i].post('/api' + path).set('Origin', origin).set('X-CSRF-Token', tokens[i]).send(body);
const patch = (i: number, path: string, body: object) =>
  agents[i].patch('/api' + path).set('Origin', origin).set('X-CSRF-Token', tokens[i]).send(body);
const read = async (i = 0) => {
  const r = await agents[i].get(`/api/tickets/${ticketId}`).expect(200);
  return r.body as Ticket & { sla: SlaView };
};
const minutes = (ms: number) => Math.round(ms / 60000);

beforeAll(async () => {
  const hash = await hashPassword(password);
  for (const [i, role] of (['EMPLOYEE', 'ENGINEER', 'ADMIN'] as const).entries()) {
    const u = await db.user.create({
      data: { email: `sla-${i}-${tag}@example.test`, name: `SLA fixture ${i}`, passwordHash: hash, role },
    });
    ids.push(u.id);
    const r = await agents[i]
      .post('/api/auth/login')
      .set('Origin', origin)
      .send({ email: u.email, password })
      .expect(200);
    tokens.push(r.body.csrfToken);
  }
  categoryId = (await db.category.create({ data: { name: `SLA ${tag}` } })).id;
});

afterAll(async () => {
  await db.outbox.deleteMany({ where: { recipientId: { in: ids } } });
  await db.reply.deleteMany({ where: { ticket: { categoryId } } });
  await db.ticketSla.deleteMany({ where: { ticket: { categoryId } } });
  await db.event.deleteMany({ where: { actorId: { in: ids } } });
  await db.ticket.deleteMany({ where: { categoryId } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.category.deleteMany({ where: { id: categoryId } });
  await db.$disconnect();
});

describe('SLA behaviour over HTTP with a controllable clock', () => {
  it('snapshots the policy and starts a running clock at creation', async () => {
    const created = await post(0, '/tickets', {
      title: `SLA clock ${tag}`,
      description: 'A synthetic ticket used to exercise SLA timers across status changes.',
      categoryId,
      priority: 'URGENT',
    }).expect(201);
    ticketId = created.body.id;
    const policy = await db.slaPolicy.findUniqueOrThrow({ where: { priority: 'URGENT' } });
    snapshot = { responseMinutes: policy.responseMinutes, resolutionMinutes: policy.resolutionMinutes };

    const t = await read();
    expect(t.sla.responseMinutes).toBe(policy.responseMinutes);
    expect(t.sla.resolutionMinutes).toBe(policy.resolutionMinutes);
    expect(t.sla.runningSince).not.toBeNull();
    expect(t.sla.paused).toBe(false);
    expect(t.sla.stopped).toBe(false);
    expect(t.sla.responseBreachAt).toBeNull();
    expect(minutes(t.sla.remainingResponseMs)).toBe(policy.responseMinutes);
  });

  it('does not let an internal note satisfy the first-response target', async () => {
    clock.advanceMinutes(2);
    await post(1, `/tickets/${ticketId}/notes`, { body: `Internal triage note ${tag}` }).expect(201);
    const t = await read();
    expect(t.sla.responseSatisfiedAt).toBeNull();
    expect(minutes(t.sla.remainingResponseMs)).toBe(snapshot.responseMinutes - 2);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticketId } })).firstRespondedAt).toBeNull();
  });

  it('reports a first-response breach once the deadline passes', async () => {
    clock.advanceMinutes(snapshot.responseMinutes); // now past the response due time
    const t = await read();
    expect(t.sla.responseBreachAt).not.toBeNull();
    expect(new Date(t.sla.responseBreachAt!).toISOString()).toBe(
      new Date(t.sla.responseDueAt).toISOString(),
    );
    expect(t.sla.responseSatisfiedAt).toBeNull();
  });

  it('satisfies first response on a public engineer reply and keeps the breach on record', async () => {
    await post(1, `/tickets/${ticketId}/replies`, { body: 'Engineer public reply for the SLA test.' }).expect(201);
    const t = await read();
    expect(t.sla.responseSatisfiedAt).not.toBeNull();
    expect(t.sla.responseBreachAt).not.toBeNull(); // history is not erased by a late reply
    const stored = await db.ticketSla.findUniqueOrThrow({ where: { ticketId } });
    expect(stored.responseSatisfiedAt).not.toBeNull();
    expect(stored.responseBreachAt).not.toBeNull();
  });

  it('pauses the resolution clock while waiting for the user and resumes on their reply', async () => {
    let t = await read(1);
    await patch(1, `/tickets/${ticketId}`, { version: t.version, status: 'IN_PROGRESS' }).expect(200);
    clock.advanceMinutes(10);
    t = await read(1);
    await patch(1, `/tickets/${ticketId}`, { version: t.version, status: 'WAITING_FOR_USER' }).expect(200);

    const paused = await read(1);
    expect(paused.sla.paused).toBe(true);
    expect(paused.sla.runningSince).toBeNull();
    const remainingWhilePaused = paused.sla.remainingResolutionMs;

    clock.advanceMinutes(120); // a long wait on the requester must not consume budget
    const stillPaused = await read(1);
    expect(stillPaused.sla.remainingResolutionMs).toBe(remainingWhilePaused);
    expect(stillPaused.sla.resolutionDueAt).toBeNull();

    await post(0, `/tickets/${ticketId}/replies`, { body: 'The requester answers and work resumes.' }).expect(201);
    const resumed = await read(1);
    expect(resumed.status).toBe('IN_PROGRESS');
    expect(resumed.sla.paused).toBe(false);
    expect(resumed.sla.runningSince).not.toBeNull();
    expect(resumed.sla.remainingResolutionMs).toBe(remainingWhilePaused);

    clock.advanceMinutes(15);
    const running = await read(1);
    expect(minutes(remainingWhilePaused - running.sla.remainingResolutionMs)).toBe(15);
  });

  it('stops the clock at resolution and survives an application restart', async () => {
    const before = await read(1);
    await patch(1, `/tickets/${ticketId}`, { version: before.version, status: 'RESOLVED' }).expect(200);
    const resolved = await read(1);
    expect(resolved.sla.stopped).toBe(true);
    expect(resolved.sla.runningSince).toBeNull();
    const elapsedAtResolution = resolved.sla.elapsedMs;

    clock.advanceMinutes(60 * 24);
    expect((await read(1)).sla.elapsedMs).toBe(elapsedAtResolution);

    // A fresh Express app with a fresh Prisma read path recomputes from persisted columns only.
    const restarted = request.agent(createApp(clock));
    const login = await restarted
      .post('/api/auth/login')
      .set('Origin', origin)
      .send({ email: `sla-1-${tag}@example.test`, password })
      .expect(200);
    expect(login.body.user.role).toBe('ENGINEER');
    const afterRestart = await restarted.get(`/api/tickets/${ticketId}`).expect(200);
    expect(afterRestart.body.sla.elapsedMs).toBe(elapsedAtResolution);
    expect(afterRestart.body.sla.stopped).toBe(true);
  });

  it('restarts the clock on reopening without erasing earlier breach history', async () => {
    const resolved = await read(1);
    const previousResponseBreach = resolved.sla.responseBreachAt;
    const elapsedBefore = resolved.sla.elapsedMs;
    expect(previousResponseBreach).not.toBeNull();

    await post(0, `/tickets/${ticketId}/reopen`, {}).expect(200);
    const reopened = await read(1);
    expect(reopened.status).toBe('OPEN');
    expect(reopened.sla.runningSince).not.toBeNull();
    expect(reopened.sla.stopped).toBe(false);
    expect(reopened.sla.responseBreachAt).toBe(previousResponseBreach);
    expect(reopened.sla.elapsedMs).toBe(elapsedBefore); // accumulated time carries forward

    clock.advanceMinutes(5);
    expect(minutes((await read(1)).sla.elapsedMs - elapsedBefore)).toBe(5);
  });

  it('produces dashboard SLA figures that match the stored rows', async () => {
    const dashboard = await agents[2].get('/api/dashboard').expect(200);
    const tickets = await db.ticket.findMany({ include: { sla: true } });
    const expected = slaMetrics(
      tickets.map((t) => ({ id: t.id, number: t.number, title: t.title, status: t.status, sla: t.sla })),
      clock.now(),
    );
    expect(dashboard.body.sla.tracked).toBe(expected.tracked);
    expect(dashboard.body.sla.responseMeasured).toBe(expected.responseMeasured);
    expect(dashboard.body.sla.responseBreached).toBe(expected.responseBreached);
    expect(dashboard.body.sla.resolutionMeasured).toBe(expected.resolutionMeasured);
    expect(dashboard.body.sla.activeBreached).toBe(expected.activeBreached);
    // The reopened fixture ticket is active and already carries a first-response breach.
    expect(dashboard.body.sla.breachedTickets.some((b: { id: string }) => b.id === ticketId)).toBe(true);
    expect(dashboard.body.sla.tracked).toBe(tickets.filter((t) => t.sla).length);
  });
});
