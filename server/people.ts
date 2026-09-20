/**
 * People and organisation: departments with cost centres and managers, the directory and
 * profiles, announcements, and the reports that turn tickets and surveys into numbers by agent,
 * department and day.
 */
import { Router } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { admin, staff, fail, idOf, person } from './http.js';
import { audit, clientIp } from './auth.js';
import { broadcast } from './realtime.js';
import { announcementSchema, departmentSchema, profileSchema } from '../shared/contracts.js';

export const peopleRouter = Router();

const profileSelect = { ...person, email: true, title: true, location: true, phone: true, active: true, createdAt: true, department: { select: { id: true, name: true, code: true, costCentre: true } }, manager: { select: person } } as const;

/* ── Directory ────────────────────────────────────────────────────────── */

peopleRouter.get('/people', async (req, res) => {
  const f = z.object({ q: z.string().trim().max(80).default(''), departmentId: z.uuid().optional(), managerId: z.uuid().optional(), role: z.enum(['EMPLOYEE', 'ENGINEER', 'ADMIN']).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(24) }).parse(req.query);
  const where = { active: true, deletedAt: null, ...(f.departmentId ? { departmentId: f.departmentId } : {}), ...(f.managerId ? { managerId: f.managerId } : {}), ...(f.role ? { role: f.role } : {}), ...(f.q ? { OR: [{ name: { contains: f.q, mode: 'insensitive' as const } }, { email: { contains: f.q, mode: 'insensitive' as const } }, { title: { contains: f.q, mode: 'insensitive' as const } }] } : {}) };
  const [items, total] = await db.$transaction([db.user.findMany({ where, select: profileSelect, orderBy: { name: 'asc' }, skip: (f.page - 1) * f.pageSize, take: f.pageSize }), db.user.count({ where })]);
  res.json({ items, total, page: f.page, pageSize: f.pageSize });
});

peopleRouter.get('/people/:id', async (req, res) => {
  const id = idOf(req);
  const me = res.locals.user;
  const p = await db.user.findFirst({ where: { id, deletedAt: null }, select: { ...profileSelect, reports: { where: { active: true, deletedAt: null }, select: person, orderBy: { name: 'asc' } } } });
  if (!p) fail(404, 'Person not found');
  // Support staff see a person's open tickets; a person sees their own; other employees see the profile only.
  const canSeeTickets = me.role !== 'EMPLOYEE' || me.id === id;
  const openTickets = canSeeTickets ? await db.ticket.findMany({ where: { requesterId: id, status: { notIn: ['RESOLVED', 'CLOSED'] } }, select: { id: true, number: true, title: true, status: true, priority: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 10 }) : [];
  const assets = canSeeTickets ? await db.asset.findMany({ where: { ownerId: id }, select: { id: true, tag: true, model: true, type: true, status: true, warrantyExpiry: true }, orderBy: { tag: 'asc' } }) : [];
  // Recently closed work gives a profile some history without widening who may see what: the same
  // rule as the open list decides, and only the caller's own profile or a support role qualifies.
  const recentlyClosed = canSeeTickets ? await db.ticket.findMany({ where: { requesterId: id, status: { in: ['RESOLVED', 'CLOSED'] } }, select: { id: true, number: true, title: true, status: true, type: true, resolvedAt: true }, orderBy: { resolvedAt: 'desc' }, take: 5 }) : [];
  const assigned = canSeeTickets && me.role !== 'EMPLOYEE' ? await db.ticket.findMany({ where: { assigneeId: id, status: { notIn: ['RESOLVED', 'CLOSED'] } }, select: { id: true, number: true, title: true, status: true, priority: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 10 }) : [];
  res.json({ ...p, openTickets, assets, recentlyClosed, assigned });
});

/** A person may edit their own contact details; department and manager are an administrator's call. */
peopleRouter.patch('/auth/profile', async (req, res) => {
  const data = profileSchema.parse(req.body);
  if (data.departmentId !== undefined || data.managerId !== undefined) fail(403, 'Department and manager are set by an administrator');
  const p = await db.user.update({ where: { id: res.locals.user.id }, data, select: profileSelect });
  res.json(p);
});

peopleRouter.patch('/admin/users/:id/profile', admin, async (req, res) => {
  const data = profileSchema.parse(req.body);
  const id = idOf(req);
  if (data.managerId === id) fail(400, 'A person cannot be their own manager');
  if (data.departmentId && !(await db.department.findUnique({ where: { id: data.departmentId } }))) fail(400, 'Unknown department');
  if (data.managerId && !(await db.user.findFirst({ where: { id: data.managerId, active: true, deletedAt: null } }))) fail(400, 'Unknown manager');
  if (!(await db.user.findFirst({ where: { id, deletedAt: null } }))) fail(404, 'User not found');
  const p = await db.user.update({ where: { id }, data, select: profileSelect });
  await audit(db, { actorId: res.locals.user.id, action: 'USER_PROFILE_UPDATED', detail: `Profile of user ${id} updated: ${Object.keys(data).join(', ')}`, ip: clientIp(req) });
  res.json(p);
});

/* ── Departments ──────────────────────────────────────────────────────── */

peopleRouter.get('/departments', async (_req, res) => {
  const rows = await db.department.findMany({ include: { manager: { select: person }, _count: { select: { members: { where: { active: true, deletedAt: null } } } } }, orderBy: { name: 'asc' } });
  res.json(rows.map((d) => ({ id: d.id, name: d.name, code: d.code, costCentre: d.costCentre, managerId: d.managerId, manager: d.manager, parentId: d.parentId, memberCount: d._count.members })));
});
peopleRouter.post('/admin/departments', admin, async (req, res) => {
  const data = departmentSchema.parse(req.body);
  if (data.managerId && !(await db.user.findFirst({ where: { id: data.managerId, active: true, deletedAt: null } }))) fail(400, 'Unknown manager');
  if (data.parentId && !(await db.department.findUnique({ where: { id: data.parentId } }))) fail(400, 'Unknown parent department');
  const d = await db.department.create({ data, include: { manager: { select: person } } });
  await audit(db, { actorId: res.locals.user.id, action: 'DEPARTMENT_CREATED', detail: `Department ${d.code} "${d.name}" created`, ip: clientIp(req) });
  res.status(201).json(d);
});
peopleRouter.put('/admin/departments/:id', admin, async (req, res) => {
  const data = departmentSchema.parse(req.body);
  const id = idOf(req);
  if (data.parentId === id) fail(400, 'A department cannot be its own parent');
  if (!(await db.department.findUnique({ where: { id } }))) fail(404, 'Department not found');
  if (data.managerId && !(await db.user.findFirst({ where: { id: data.managerId, active: true, deletedAt: null } }))) fail(400, 'Unknown manager');
  const d = await db.department.update({ where: { id }, data, include: { manager: { select: person } } });
  await audit(db, { actorId: res.locals.user.id, action: 'DEPARTMENT_UPDATED', detail: `Department ${d.code} updated`, ip: clientIp(req) });
  res.json(d);
});
peopleRouter.delete('/admin/departments/:id', admin, async (req, res) => {
  const id = idOf(req);
  const members = await db.user.count({ where: { departmentId: id } });
  if (members) fail(409, `Move its ${members} member(s) first`);
  const deleted = await db.department.deleteMany({ where: { id } });
  if (!deleted.count) fail(404, 'Department not found');
  await audit(db, { actorId: res.locals.user.id, action: 'DEPARTMENT_DELETED', detail: `Department ${id} deleted`, ip: clientIp(req) });
  res.status(204).end();
});

/* ── Announcements ────────────────────────────────────────────────────── */

peopleRouter.get('/announcements', async (_req, res) => {
  const me = res.locals.user;
  const now = new Date();
  const rows = await db.announcement.findMany({ where: { publishedAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], ...(me.role === 'EMPLOYEE' ? { audience: 'ALL' } : {}) }, include: { author: { select: person } }, orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }], take: 20 });
  res.json(rows);
});
peopleRouter.get('/admin/announcements', admin, async (_req, res) => res.json(await db.announcement.findMany({ include: { author: { select: person } }, orderBy: { publishedAt: 'desc' } })));
peopleRouter.post('/admin/announcements', admin, async (req, res) => {
  const data = announcementSchema.parse(req.body);
  const a = await db.announcement.create({ data: { ...data, expiresAt: data.expiresAt ? new Date(data.expiresAt) : null, authorId: res.locals.user.id }, include: { author: { select: person } } });
  await audit(db, { actorId: res.locals.user.id, action: 'ANNOUNCEMENT_PUBLISHED', detail: `"${a.title}" to ${a.audience}`, ip: clientIp(req) });
  broadcast({ type: 'announcement' });
  res.status(201).json(a);
});
peopleRouter.put('/admin/announcements/:id', admin, async (req, res) => {
  const data = announcementSchema.parse(req.body);
  const id = idOf(req);
  if (!(await db.announcement.findUnique({ where: { id } }))) fail(404, 'Announcement not found');
  const a = await db.announcement.update({ where: { id }, data: { ...data, expiresAt: data.expiresAt ? new Date(data.expiresAt) : null }, include: { author: { select: person } } });
  broadcast({ type: 'announcement' });
  res.json(a);
});
peopleRouter.delete('/admin/announcements/:id', admin, async (req, res) => {
  const deleted = await db.announcement.deleteMany({ where: { id: idOf(req) } });
  if (!deleted.count) fail(404, 'Announcement not found');
  broadcast({ type: 'announcement' });
  res.status(204).end();
});

/* ── Reports ──────────────────────────────────────────────────────────── */

peopleRouter.get('/reports', staff, async (req, res) => {
  const { days } = z.object({ days: z.coerce.number().int().min(7).max(365).default(30) }).parse(req.query);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [tickets, surveys, agents, departments] = await Promise.all([
    db.ticket.findMany({ where: { createdAt: { gte: since } }, select: { id: true, type: true, status: true, assigneeId: true, createdAt: true, resolvedAt: true, requester: { select: { departmentId: true } } } }),
    db.survey.findMany({ where: { createdAt: { gte: since } }, select: { score: true, ticket: { select: { assigneeId: true } } } }),
    db.user.findMany({ where: { role: { in: ['ENGINEER', 'ADMIN'] }, active: true, deletedAt: null }, select: person }),
    db.department.findMany({ select: { id: true, name: true, code: true, costCentre: true } }),
  ]);
  const resolvedIn = await db.ticket.findMany({ where: { resolvedAt: { gte: since } }, select: { assigneeId: true, createdAt: true, resolvedAt: true } });
  const openNow = await db.ticket.findMany({ where: { status: { notIn: ['RESOLVED', 'CLOSED'] } }, select: { assigneeId: true, requester: { select: { departmentId: true } } } });
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const csatBy = new Map<string, number[]>();
  for (const s of surveys) if (s.ticket.assigneeId) csatBy.set(s.ticket.assigneeId, [...(csatBy.get(s.ticket.assigneeId) ?? []), s.score]);
  const agentRows = agents.map((a) => {
    const resolved = resolvedIn.filter((t) => t.assigneeId === a.id);
    const scores = csatBy.get(a.id) ?? [];
    return { id: a.id, name: a.name, resolved: resolved.length, open: openNow.filter((t) => t.assigneeId === a.id).length, averageResolutionMinutes: avg(resolved.map((t) => (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 60000)), csat: scores.length ? Math.round((scores.reduce((x, y) => x + y, 0) / scores.length) * 10) / 10 : null };
  }).sort((a, b) => b.resolved - a.resolved);
  const departmentRows = departments.map((d) => ({ ...d, tickets: tickets.filter((t) => t.requester.departmentId === d.id).length, open: openNow.filter((t) => t.requester.departmentId === d.id).length })).sort((a, b) => b.tickets - a.tickets);
  const distribution: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  for (const s of surveys) distribution[String(s.score)] += 1;
  const byType: Record<string, number> = {};
  for (const t of tickets) byType[t.type] = (byType[t.type] ?? 0) + 1;
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const perDay = new Map<string, { created: number; resolved: number }>();
  for (let i = days - 1; i >= 0; i--) perDay.set(dayKey(new Date(Date.now() - i * 86400000)), { created: 0, resolved: 0 });
  for (const t of tickets) { const k = dayKey(t.createdAt); if (perDay.has(k)) perDay.get(k)!.created += 1; }
  for (const t of resolvedIn) { const k = dayKey(t.resolvedAt!); if (perDay.has(k)) perDay.get(k)!.resolved += 1; }
  res.json({
    windowDays: days,
    csat: { responses: surveys.length, average: surveys.length ? Math.round((surveys.reduce((a, s) => a + s.score, 0) / surveys.length) * 10) / 10 : null, distribution },
    agents: agentRows,
    departments: departmentRows,
    byType,
    createdPerDay: [...perDay.entries()].map(([day, v]) => ({ day, ...v })),
  });
});
