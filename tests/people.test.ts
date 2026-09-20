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

const app = createApp();
const origin = config.APP_ORIGIN;
const tag = randomUUID();
const password = 'Synthetic-people-password-2026';
const ids: string[] = [];
const agents = { employee: request.agent(app), engineer: request.agent(app), admin: request.agent(app) };
const csrf: Record<string, string> = {};
const userId: Record<string, string> = {};
let categoryId = '';
const send = (who: keyof typeof agents, method: 'post' | 'put' | 'patch' | 'delete', path: string, body?: unknown) => {
  const r = agents[who][method](`/api${path}`).set('Origin', origin).set('X-CSRF-Token', csrf[who]);
  return body === undefined ? r : r.send(body as object);
};

beforeAll(async () => {
  const hash = await hashPassword(password);
  for (const [name, role] of [['employee', 'EMPLOYEE'], ['engineer', 'ENGINEER'], ['admin', 'ADMIN']] as const) {
    const u = await db.user.create({ data: { email: `pp-${name}-${tag}@example.test`, name: `Pp ${name}`, passwordHash: hash, role, title: name === 'engineer' ? 'Network Engineer' : null } });
    ids.push(u.id);
    userId[name] = u.id;
    csrf[name] = (await agents[name].post('/api/auth/login').set('Origin', origin).send({ email: u.email, password }).expect(200)).body.csrfToken;
  }
  categoryId = (await db.category.create({ data: { name: `Pp ${tag}` } })).id;
});
afterAll(async () => {
  await db.event.deleteMany({ where: { actorId: { in: ids } } });
  await db.announcement.deleteMany({ where: { title: { contains: tag } } });
  const mine = (await db.ticket.findMany({ where: { requesterId: { in: ids } }, select: { id: true } })).map((t) => t.id);
  await db.event.deleteMany({ where: { ticketId: { in: mine } } });
  await db.reply.deleteMany({ where: { ticketId: { in: mine } } });
  await db.ticketSla.deleteMany({ where: { ticketId: { in: mine } } });
  await db.ticket.deleteMany({ where: { id: { in: mine } } });
  await db.department.deleteMany({ where: { name: { contains: tag } } });
  await db.category.deleteMany({ where: { id: categoryId } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

describe('departments and profiles', () => {
  let deptId = '';
  it('an administrator creates a department with a cost centre and manager; codes are normalised and unique', async () => {
    await send('engineer', 'post', '/admin/departments', { name: `Ops ${tag}`, code: 'OPS1' }).expect(403);
    const r = await send('admin', 'post', '/admin/departments', { name: `Ops ${tag}`, code: `o${tag.slice(0, 5)}`, costCentre: 'CC-9', managerId: userId.engineer }).expect(201);
    deptId = r.body.id;
    expect(r.body.code).toBe(`O${tag.slice(0, 5).toUpperCase()}`);
    expect(r.body.manager.id).toBe(userId.engineer);
    await send('admin', 'post', '/admin/departments', { name: `Ops dup ${tag}`, code: `o${tag.slice(0, 5)}` }).expect(409);
    const bad = await send('admin', 'post', '/admin/departments', { name: `Bad ${tag}`, code: 'has space' }).expect(400);
    expect(bad.body.error).toBe('Invalid request');
  });
  it('people are placed in departments by an administrator; they edit only their own contact details', async () => {
    await send('employee', 'patch', '/auth/profile', { departmentId: deptId }).expect(403);
    const me = await send('employee', 'patch', '/auth/profile', { title: 'Analyst', location: 'Pune', phone: '+91 00000 00000' }).expect(200);
    expect(me.body).toMatchObject({ title: 'Analyst', location: 'Pune' });
    await send('admin', 'patch', `/admin/users/${userId.employee}/profile`, { managerId: userId.employee }).expect(400);
    const placed = await send('admin', 'patch', `/admin/users/${userId.employee}/profile`, { departmentId: deptId, managerId: userId.engineer }).expect(200);
    expect(placed.body.department.id).toBe(deptId);
    expect(placed.body.manager.id).toBe(userId.engineer);
    const list = await agents.engineer.get('/api/departments').expect(200);
    expect(list.body.find((d: { id: string }) => d.id === deptId).memberCount).toBe(1);
    await send('admin', 'delete', `/admin/departments/${deptId}`).expect(409);
  });
  it('the directory is searchable and filterable, and profiles show what the role may see', async () => {
    const byDept = await agents.employee.get(`/api/people?departmentId=${deptId}`).expect(200);
    expect(byDept.body.items.map((p: { id: string }) => p.id)).toEqual([userId.employee]);
    const byTitle = await agents.employee.get('/api/people?q=Network Engineer').expect(200);
    expect(byTitle.body.items.some((p: { id: string }) => p.id === userId.engineer)).toBe(true);
    expect(JSON.stringify(byTitle.body)).not.toMatch(/passwordHash|mfaSecret|failedLogins/);
    const ticket = await send('employee', 'post', '/tickets', { title: `Profile ticket ${tag}`, description: 'A ticket that should appear on the requester profile for staff.', categoryId }).expect(201);
    const asEngineer = await agents.engineer.get(`/api/people/${userId.employee}`).expect(200);
    expect(asEngineer.body.openTickets.some((t: { id: string }) => t.id === ticket.body.id)).toBe(true);
    expect(asEngineer.body.reports).toEqual([]);
    const asSelf = await agents.employee.get(`/api/people/${userId.employee}`).expect(200);
    expect(asSelf.body.openTickets.length).toBeGreaterThan(0);
    const managerView = await agents.employee.get(`/api/people/${userId.engineer}`).expect(200);
    expect(managerView.body.openTickets).toEqual([]);
    expect(managerView.body.reports.map((r: { id: string }) => r.id)).toContain(userId.employee);
  });
});

describe('announcements', () => {
  it('reach the chosen audience, respect expiry and pinning, and are administrator-only to publish', async () => {
    await send('engineer', 'post', '/admin/announcements', { title: `Nope ${tag}`, body: 'Engineers cannot publish' }).expect(403);
    const everyone = await send('admin', 'post', '/admin/announcements', { title: `Everyone ${tag}`, body: 'Fictional notice for all', audience: 'ALL', pinned: true }).expect(201);
    const staffOnly = await send('admin', 'post', '/admin/announcements', { title: `Staff ${tag}`, body: 'Fictional notice for staff', audience: 'STAFF' }).expect(201);
    const expired = await send('admin', 'post', '/admin/announcements', { title: `Expired ${tag}`, body: 'Gone already', audience: 'ALL', expiresAt: new Date(Date.now() - 1000).toISOString() }).expect(201);
    const forEmployee = await agents.employee.get('/api/announcements').expect(200);
    const titles = forEmployee.body.map((a: { title: string }) => a.title);
    expect(titles).toContain(`Everyone ${tag}`);
    expect(titles).not.toContain(`Staff ${tag}`);
    expect(titles).not.toContain(`Expired ${tag}`);
    expect(forEmployee.body[0].pinned).toBe(true);
    const forStaff = await agents.engineer.get('/api/announcements').expect(200);
    expect(forStaff.body.map((a: { title: string }) => a.title)).toContain(`Staff ${tag}`);
    await send('admin', 'delete', `/admin/announcements/${staffOnly.body.id}`).expect(204);
    await send('admin', 'delete', `/admin/announcements/${expired.body.id}`).expect(204);
    await send('admin', 'put', `/admin/announcements/${everyone.body.id}`, { title: `Everyone ${tag}`, body: 'Updated', audience: 'ALL', pinned: false }).expect(200);
  });
});

describe('reports', () => {
  it('are for support staff, cover the window, and list agents and departments with reproducible counts', async () => {
    await agents.employee.get('/api/reports').expect(403);
    const t = await send('employee', 'post', '/tickets', { title: `Report ticket ${tag}`, description: 'A ticket to be resolved and rated so the reports have something to count.', categoryId }).expect(201);
    await send('engineer', 'patch', `/tickets/${t.body.id}`, { version: t.body.version, assigneeId: userId.engineer, status: 'IN_PROGRESS' }).expect(200);
    const v = (await db.ticket.findUniqueOrThrow({ where: { id: t.body.id } })).version;
    await send('engineer', 'patch', `/tickets/${t.body.id}`, { version: v, status: 'RESOLVED' }).expect(200);
    await send('employee', 'post', `/tickets/${t.body.id}/survey`, { score: 5 }).expect(201);
    const r = await agents.engineer.get('/api/reports?days=7').expect(200);
    expect(r.body.windowDays).toBe(7);
    expect(r.body.csat.responses).toBeGreaterThanOrEqual(1);
    expect(r.body.csat.distribution['5']).toBeGreaterThanOrEqual(1);
    const agent = r.body.agents.find((a: { id: string }) => a.id === userId.engineer);
    expect(agent.resolved).toBeGreaterThanOrEqual(1);
    expect(agent.csat).toBe(5);
    expect(typeof agent.averageResolutionMinutes).toBe('number');
    expect(r.body.createdPerDay).toHaveLength(7);
    expect(r.body.createdPerDay.at(-1).created).toBeGreaterThanOrEqual(1);
    const dept = r.body.departments.find((d: { name: string }) => d.name === `Ops ${tag}`);
    expect(dept.tickets).toBeGreaterThanOrEqual(1);
    await agents.engineer.get('/api/reports?days=3').expect(400);
  });
});
