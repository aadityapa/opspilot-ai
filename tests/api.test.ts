import 'dotenv/config';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { db } from '../server/db.js';
import { config, parseConfig } from '../server/config.js';
import { hashPassword } from '../server/password.js';
if (config.NODE_ENV !== 'test' || !new URL(config.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Integration tests require NODE_ENV=test and a database name ending in _test');
const app = createApp(),
  origin = config.APP_ORIGIN,
  tag = randomUUID(),
  password = 'Synthetic-test-password-2026';
const employee = request.agent(app),
  other = request.agent(app),
  engineer = request.agent(app),
  admin = request.agent(app);
let employeeCsrf = '',
  otherCsrf = '',
  engineerCsrf = '',
  adminCsrf = '',
  categoryId = '',
  ticketId = '',
  engineerId = '',
  employeeId = '',
  createdUserId = '';
const userIds: string[] = [];
async function login(agent: ReturnType<typeof request.agent>, email: string) {
  const r = await agent
    .post('/api/auth/login')
    .set('Origin', origin)
    .send({ email, password })
    .expect(200);
  expect(r.headers['set-cookie'][0]).toContain('HttpOnly');
  expect(r.headers['set-cookie'][0]).toContain('SameSite=Strict');
  return r.body.csrfToken;
}
beforeAll(async () => {
  const hash = await hashPassword(password);
  for (const [role, name] of [
    ['EMPLOYEE', 'employee'],
    ['EMPLOYEE', 'other'],
    ['ENGINEER', 'engineer'],
    ['ADMIN', 'admin'],
  ] as const) {
    const u = await db.user.create({
      data: { email: `${name}-${tag}@example.test`, name, passwordHash: hash, role },
    });
    userIds.push(u.id);
    if (name === 'engineer') engineerId = u.id;
    if (name === 'employee') employeeId = u.id;
  }
  categoryId = (await db.category.create({ data: { name: `Test category ${tag}` } })).id;
  employeeCsrf = await login(employee, `employee-${tag}@example.test`);
  otherCsrf = await login(other, `other-${tag}@example.test`);
  engineerCsrf = await login(engineer, `engineer-${tag}@example.test`);
  adminCsrf = await login(admin, `admin-${tag}@example.test`);
});
afterAll(async () => {
  const tickets = await db.ticket.findMany({ where: { categoryId }, select: { id: true } });
  const ids = tickets.map((t) => t.id);
  await db.reply.deleteMany({ where: { ticketId: { in: ids } } });
  await db.event.deleteMany({
    where: { OR: [{ ticketId: { in: ids } }, { actorId: { in: userIds } }] },
  });
  await db.ticket.deleteMany({ where: { id: { in: ids } } });
  await db.user.deleteMany({
    where: { id: { in: [...userIds, ...(createdUserId ? [createdUserId] : [])] } },
  });
  await db.category.deleteMany({ where: { id: categoryId } });
  await db.$disconnect();
});
describe('real PostgreSQL API workflow', () => {
  it('rejects missing login origin, missing session and malformed login', async () => {
    await request(app).post('/api/auth/login').send({}).expect(403);
    await request(app).get('/api/tickets').expect(401);
    await request(app)
      .post('/api/auth/login')
      .set('Origin', origin)
      .send({ email: 'nope' })
      .expect(400);
  });
  it('creates a ticket without any AI integration', async () => {
    const r = await employee
      .post('/api/tickets')
      .set('Origin', origin)
      .set('X-CSRF-Token', employeeCsrf)
      .send({
        title: `VPN issue ${tag}`,
        description: 'The VPN repeatedly disconnects during a call.',
        categoryId,
        priority: 'HIGH',
      })
      .expect(201);
    ticketId = r.body.id;
    expect(r.body.requesterId).toBe(employeeId);
    expect(r.body.status).toBe('OPEN');
  });
  it('blocks ID-based access, replies and reopening from another employee', async () => {
    await other.get(`/api/tickets/${ticketId}`).expect(404);
    await other
      .post(`/api/tickets/${ticketId}/replies`)
      .set('Origin', origin)
      .set('X-CSRF-Token', otherCsrf)
      .send({ body: 'Can I read this?' })
      .expect(404);
    await other
      .post(`/api/tickets/${ticketId}/reopen`)
      .set('Origin', origin)
      .set('X-CSRF-Token', otherCsrf)
      .send({})
      .expect(404);
    const r = await other.get(`/api/tickets?q=${tag}`).expect(200);
    expect(r.body.total).toBe(0);
  });
  it('rejects CSRF, arbitrary assignees and employee mutations', async () => {
    await employee.post('/api/tickets').set('Origin', origin).send({}).expect(403);
    await employee
      .patch(`/api/tickets/${ticketId}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', employeeCsrf)
      .send({ version: 0, status: 'RESOLVED' })
      .expect(403);
    await engineer
      .patch(`/api/tickets/${ticketId}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', engineerCsrf)
      .send({ version: 0, assigneeId: employeeId })
      .expect(400);
  });
  it('never exposes internal replies and rejects internal-note writes', async () => {
    await db.reply.create({
      data: { ticketId, authorId: engineerId, body: 'Internal synthetic secret', internal: true },
    });
    const r = await employee.get(`/api/tickets/${ticketId}`).expect(200);
    expect(JSON.stringify(r.body)).not.toContain('Internal synthetic secret');
    await employee
      .post(`/api/tickets/${ticketId}/replies`)
      .set('Origin', origin)
      .set('X-CSRF-Token', employeeCsrf)
      .send({ body: 'Hidden note', internal: true })
      .expect(400);
  });
  it('assigns the engineer and starts work; rejects stale edits and invalid transitions', async () => {
    await engineer
      .patch(`/api/tickets/${ticketId}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', engineerCsrf)
      .send({ version: 0, status: 'CLOSED' })
      .expect(409);
    const r = await engineer
      .patch(`/api/tickets/${ticketId}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', engineerCsrf)
      .send({ version: 0, status: 'IN_PROGRESS', assigneeId: engineerId })
      .expect(200);
    expect(r.body.assigneeId).toBe(engineerId);
    await engineer
      .patch(`/api/tickets/${ticketId}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', engineerCsrf)
      .send({ version: 0, priority: 'LOW' })
      .expect(409);
  });
  it('records a first response and resolves the ticket', async () => {
    await engineer
      .post(`/api/tickets/${ticketId}/replies`)
      .set('Origin', origin)
      .set('X-CSRF-Token', engineerCsrf)
      .send({ body: 'The VPN profile was corrected. Please reconnect.' })
      .expect(201);
    const before = await db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(before.firstRespondedAt).not.toBeNull();
    await engineer
      .patch(`/api/tickets/${ticketId}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', engineerCsrf)
      .send({ version: before.version, status: 'RESOLVED' })
      .expect(200);
    expect(
      (await db.ticket.findUniqueOrThrow({ where: { id: ticketId } })).resolvedAt,
    ).not.toBeNull();
  });
  it('dashboard counts match persisted records', async () => {
    const r = await employee.get('/api/dashboard').expect(200);
    expect(r.body.total).toBe(await db.ticket.count({ where: { requesterId: employeeId } }));
    expect(r.body.resolved).toBe(1);
    expect(r.body.active).toBe(0);
    expect(r.body.resolutionMinutes).toBeGreaterThanOrEqual(0);
  });
  it('reopens, clears resolution time, and resumes waiting tickets on employee reply', async () => {
    await employee
      .post(`/api/tickets/${ticketId}/reopen`)
      .set('Origin', origin)
      .set('X-CSRF-Token', employeeCsrf)
      .send({})
      .expect(200);
    let t = await db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(t.resolvedAt).toBeNull();
    for (const status of ['IN_PROGRESS', 'WAITING_FOR_USER']) {
      await engineer
        .patch(`/api/tickets/${ticketId}`)
        .set('Origin', origin)
        .set('X-CSRF-Token', engineerCsrf)
        .send({ version: t.version, status })
        .expect(200);
      t = await db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    }
    await employee
      .post(`/api/tickets/${ticketId}/replies`)
      .set('Origin', origin)
      .set('X-CSRF-Token', employeeCsrf)
      .send({ body: 'I have sent the requested information.' })
      .expect(201);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe(
      'IN_PROGRESS',
    );
  });
  it('restricts user administration and revokes disabled account sessions', async () => {
    await employee.get('/api/admin/users').expect(403);
    await engineer.get('/api/admin/users').expect(403);
    const r = await admin
      .post('/api/admin/users')
      .set('Origin', origin)
      .set('X-CSRF-Token', adminCsrf)
      .send({
        name: 'New synthetic user',
        email: `new-${tag}@example.test`,
        password,
        role: 'EMPLOYEE',
      })
      .expect(201);
    createdUserId = r.body.id;
    expect(r.body.passwordHash).toBeUndefined();
    await admin
      .patch(`/api/admin/users/${employeeId}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', adminCsrf)
      .send({ active: false })
      .expect(200);
    await employee.get('/api/auth/me').expect(401);
  });
  it('records ticket and administrative audits atomically', async () => {
    expect(await db.event.count({ where: { ticketId } })).toBeGreaterThan(5);
    expect(await db.event.count({ where: { actorId: userIds[3], action: 'USER_CREATED' } })).toBe(
      1,
    );
  });
  it('invalidates logout sessions and enforces production configuration', async () => {
    await engineer
      .post('/api/auth/logout')
      .set('Origin', origin)
      .set('X-CSRF-Token', engineerCsrf)
      .send({})
      .expect(204);
    await engineer.get('/api/auth/me').expect(401);
    expect(() =>
      parseConfig({ ...process.env, NODE_ENV: 'production', ALLOW_DEMO_SEED: 'true' }),
    ).toThrow();
  });
});
