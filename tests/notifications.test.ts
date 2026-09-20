import 'dotenv/config';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { db } from '../server/db.js';
import { createApp } from '../server/app.js';
import { deliverOne, notificationText, scanBreaches, type Delivery } from '../server/notifications.js';
import { hashPassword } from '../server/password.js';
import { config } from '../server/config.js';
import type { Clock } from '../server/sla.js';

if (config.NODE_ENV !== 'test' || !new URL(config.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Dedicated test database required');

class TestClock implements Clock {
  constructor(private current: Date) {}
  now() {
    return new Date(this.current);
  }
  advanceMinutes(minutes: number) {
    this.current = new Date(this.current.getTime() + minutes * 60000);
  }
}

// Outbox rows take their initial `nextAttemptAt` from the database default (CURRENT_TIMESTAMP),
// so this clock starts at the real current time and only relative advances matter.
const clock = new TestClock(new Date());
const app = createApp(clock);
const origin = config.APP_ORIGIN;
const tag = randomUUID();
const password = 'Synthetic-notifications-2026';
const agents = [request.agent(app), request.agent(app), request.agent(app)]; // employee, engineer, admin
const ids: string[] = [];
const tokens: string[] = [];
let categoryId = '';
let ticketId = '';
const noteSecret = `NOTEONLY-${tag}`;

const post = (i: number, path: string, body: object) =>
  agents[i].post('/api' + path).set('Origin', origin).set('X-CSRF-Token', tokens[i]).send(body);
const patch = (i: number, path: string, body: object) =>
  agents[i].patch('/api' + path).set('Origin', origin).set('X-CSRF-Token', tokens[i]).send(body);
const outboxFor = () => db.outbox.findMany({ where: { ticketId }, orderBy: { createdAt: 'asc' } });

beforeAll(async () => {
  const hash = await hashPassword(password);
  for (const [i, role] of (['EMPLOYEE', 'ENGINEER', 'ADMIN'] as const).entries()) {
    const u = await db.user.create({
      data: { email: `note-${i}-${tag}@example.test`, name: `Outbox fixture ${i}`, passwordHash: hash, role },
    });
    ids.push(u.id);
    const r = await agents[i]
      .post('/api/auth/login')
      .set('Origin', origin)
      .send({ email: u.email, password })
      .expect(200);
    tokens.push(r.body.csrfToken);
  }
  categoryId = (await db.category.create({ data: { name: `Outbox ${tag}` } })).id;
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

describe('notification outbox', () => {
  it('queues one assignment message and deduplicates a repeated assignment', async () => {
    const created = await post(0, '/tickets', {
      title: `Outbox ticket ${tag}`,
      description: 'A synthetic ticket used to exercise assignment and reply notifications.',
      categoryId,
      priority: 'HIGH',
    }).expect(201);
    ticketId = created.body.id;

    await patch(1, `/tickets/${ticketId}`, { version: created.body.version, assigneeId: ids[1] }).expect(200);
    const afterAssign = await agents[1].get(`/api/tickets/${ticketId}`).expect(200);
    // Re-saving the same assignee must not queue a second message for the same engineer.
    await patch(1, `/tickets/${ticketId}`, { version: afterAssign.body.version, assigneeId: ids[1] }).expect(200);

    const assignments = (await outboxFor()).filter((o) => o.kind === 'ASSIGNMENT');
    expect(assignments).toHaveLength(1);
    expect(assignments[0].recipientId).toBe(ids[1]);
    expect(assignments[0].status).toBe('PENDING');
  });

  it('notifies the requester about a public reply but never about an internal note', async () => {
    await post(1, `/tickets/${ticketId}/notes`, { body: noteSecret }).expect(201);
    expect((await outboxFor()).filter((o) => o.recipientId === ids[0])).toHaveLength(0);

    await post(1, `/tickets/${ticketId}/replies`, { body: 'A public engineer reply the requester should hear about.' }).expect(201);
    const replies = (await outboxFor()).filter((o) => o.kind === 'PUBLIC_REPLY');
    expect(replies.map((o) => o.recipientId)).toEqual([ids[0]]); // author is excluded from their own reply

    // Neither the stored rows nor any employee-facing feed may carry internal content.
    expect(JSON.stringify(await outboxFor())).not.toContain(noteSecret);
    const feed = await agents[0].get('/api/notifications').expect(200);
    expect(JSON.stringify(feed.body)).not.toContain(noteSecret);
    expect(feed.body.items[0].text).toBe(notificationText('PUBLIC_REPLY', feed.body.items[0].ticket.number));
  });

  it('does not create duplicate rows when a failing delivery is retried', async () => {
    const before = await outboxFor();
    let attempts = 0;
    const failing = async () => {
      attempts++;
      throw new Error('simulated local mail failure');
    };
    // Two failing passes, then two more after the backoff window: four delivery attempts in total
    // across the same set of queued jobs.
    expect(await deliverOne(failing, clock)).toBe(true);
    expect(await deliverOne(failing, clock)).toBe(true);
    clock.advanceMinutes(120); // let the exponential backoff elapse so the same rows become due again
    expect(await deliverOne(failing, clock)).toBe(true);
    expect(await deliverOne(failing, clock)).toBe(true);

    const after = await outboxFor();
    expect(attempts).toBe(4);
    // The acceptance criterion: retrying never adds a row, and never changes which rows exist.
    expect(after).toHaveLength(before.length);
    expect(after.map((o) => o.dedupeKey).sort()).toEqual(before.map((o) => o.dedupeKey).sort());
    expect(after.reduce((sum, o) => sum + o.attempts, 0)).toBe(4);
    expect(after.every((o) => o.status === 'PENDING' && o.sentAt === null)).toBe(true);
    expect(after.every((o) => o.attempts === 2)).toBe(true);
    expect(await db.outbox.count({ where: { ticketId, status: 'SENT' } })).toBe(0);
  });

  it('marks a job sent exactly once and never re-sends it', async () => {
    clock.advanceMinutes(10); // let the backoff from the previous failure elapse
    const sent: Delivery[] = [];
    const sender = async (message: Delivery) => {
      sent.push(message);
    };
    let processed = 0;
    while (await deliverOne(sender, clock)) if (++processed > 20) break;

    const rows = await outboxFor();
    expect(rows.every((o) => o.status === 'SENT' || o.status === 'CANCELLED')).toBe(true);
    const sentRows = rows.filter((o) => o.status === 'SENT');
    expect(sent).toHaveLength(sentRows.length);
    expect(new Set(sent.map((m) => m.messageId)).size).toBe(sent.length);
    expect(sent.every((m) => !m.text.includes(noteSecret))).toBe(true);

    // A further pass finds nothing left to do, so no message is delivered twice.
    expect(await deliverOne(sender, clock)).toBe(false);
    expect(sent).toHaveLength(sentRows.length);
  });

  it('queues an SLA breach notification once, however often the scan runs', async () => {
    clock.advanceMinutes(60 * 24 * 30); // far past both deadlines for the fixture ticket
    await scanBreaches(clock);
    await scanBreaches(clock);
    await scanBreaches(clock);

    const breaches = (await outboxFor()).filter((o) => o.kind.startsWith('SLA_'));
    expect(breaches.length).toBeGreaterThan(0);
    expect(new Set(breaches.map((o) => o.dedupeKey)).size).toBe(breaches.length);
    expect(breaches.every((o) => o.recipientId !== undefined)).toBe(true);

    const stored = await db.ticketSla.findUniqueOrThrow({ where: { ticketId } });
    expect(stored.resolutionBreachAt).not.toBeNull();
  });

  it('keeps the outbox monitor and retry endpoint administrator-only', async () => {
    await agents[0].get('/api/admin/outbox').expect(403);
    await agents[1].get('/api/admin/outbox').expect(403);
    const monitor = await agents[2].get('/api/admin/outbox').expect(200);
    expect(monitor.body.total).toBeGreaterThan(0);

    const anySent = (await outboxFor()).find((o) => o.status === 'SENT');
    if (anySent) await post(2, `/admin/outbox/${anySent.id}/retry`, {}).expect(409); // only failed jobs retry
  });

  it('scopes the notification feed to the signed-in recipient', async () => {
    const employee = await agents[0].get('/api/notifications').expect(200);
    const engineer = await agents[1].get('/api/notifications').expect(200);
    const employeeRows = await db.outbox.count({ where: { recipientId: ids[0] } });
    expect(employee.body.total).toBe(employeeRows);
    expect(employee.body.items.every((n: { ticketId: string }) => n.ticketId === ticketId)).toBe(true);
    expect(engineer.body.items.some((n: { kind: string }) => n.kind === 'ASSIGNMENT')).toBe(true);
  });
});
