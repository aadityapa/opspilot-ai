/**
 * Workspace features on top of the ticket core: the board, saved views and bulk actions; the
 * service catalog with dynamic forms and approvals; templates; watchers, mentions, attachments,
 * comment editing and the activity stream; satisfaction surveys.
 *
 * Authorisation is the same everywhere: `canReadTicket` (own tickets for employees, everything for
 * support), extended by `canAccess` to let an approver see the request they are deciding on.
 */
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { searchLimit, uploadLimit } from './limits.js';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, createReadStream } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import { resolve, extname, basename } from 'node:path';
import { z } from 'zod';
import { db } from './db.js';
import { config } from './config.js';
import { admin, staff, fail, idOf, person, HttpError } from './http.js';
import { canReadTicket, canTransition } from './domain.js';
import { enqueue } from './notifications.js';
import { audit, clientIp } from './auth.js';
import { notifyUsers } from './realtime.js';
import { advanceSla, newSla, slaView, systemClock, type Clock } from './sla.js';
import { checkAssetLink } from './assets.js';
import { pageSchema } from '../shared/operations.js';
import {
  approvalDecisionSchema, bulkSchema, catalogItemSchema, savedViewSchema, surveySchema, templateSchema, ticketSchema,
  priorityFor, statuses, type FormField,
} from '../shared/contracts.js';
import type { Prisma } from '../generated/prisma/client.js';

type Tx = Prisma.TransactionClient;
const user = (res: Response) => res.locals.user;

/** Requester or support, plus anyone with an approval row on the ticket. */
export async function canAccess(tx: Tx | typeof db, who: { id: string; role: 'EMPLOYEE' | 'ENGINEER' | 'ADMIN' }, ticket: { id: string; requesterId: string }) {
  if (canReadTicket(who, ticket)) return true;
  return (await tx.approval.count({ where: { ticketId: ticket.id, approverId: who.id } })) > 0;
}

/* ── Catalog forms and approvals ──────────────────────────────────────── */

/** Validates submitted answers against a catalog item's field schema. Returns the cleaned answers. */
export function validateForm(fields: FormField[], data: Record<string, unknown> | undefined) {
  const out: Record<string, string | number | boolean> = {};
  const problems: string[] = [];
  for (const field of fields) {
    const raw = data?.[field.key];
    const empty = raw === undefined || raw === null || raw === '';
    if (empty) {
      if (field.required && field.kind !== 'checkbox') problems.push(`${field.label} is required`);
      if (field.kind === 'checkbox') out[field.key] = false;
      continue;
    }
    switch (field.kind) {
      case 'text':
      case 'textarea':
        if (typeof raw !== 'string' || raw.length > (field.kind === 'text' ? 200 : 4000)) problems.push(`${field.label} is too long`);
        else out[field.key] = raw.trim();
        break;
      case 'select':
        if (typeof raw !== 'string' || !field.options?.includes(raw)) problems.push(`${field.label} must be one of the offered options`);
        else out[field.key] = raw;
        break;
      case 'number': {
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(n)) problems.push(`${field.label} must be a number`);
        else out[field.key] = n;
        break;
      }
      case 'date':
        if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) problems.push(`${field.label} must be a date (YYYY-MM-DD)`);
        else out[field.key] = raw;
        break;
      case 'checkbox':
        out[field.key] = raw === true || raw === 'true' || raw === 'on';
        break;
    }
  }
  const unknown = Object.keys(data ?? {}).filter((k) => !fields.some((f) => f.key === k));
  if (unknown.length) problems.push(`Unexpected field(s): ${unknown.join(', ')}`);
  return { ok: problems.length === 0, problems, data: out };
}

/** Who must approve a request from this requester for this catalog item. Null when nobody can be found. */
async function resolveApprover(tx: Tx, item: { approverKind: string; approverDepartmentId: string | null }, requesterId: string) {
  if (item.approverKind === 'ADMIN') {
    const a = await tx.user.findFirst({ where: { role: 'ADMIN', active: true, deletedAt: null, id: { not: requesterId } }, orderBy: { createdAt: 'asc' } });
    return a?.id ?? null;
  }
  if (item.approverKind === 'DEPARTMENT_MANAGER' && item.approverDepartmentId) {
    const d = await tx.department.findUnique({ where: { id: item.approverDepartmentId }, select: { managerId: true } });
    if (d?.managerId && d.managerId !== requesterId) return d.managerId;
  }
  const requester = await tx.user.findUnique({ where: { id: requesterId }, select: { managerId: true, department: { select: { managerId: true } } } });
  const manager = requester?.managerId ?? requester?.department?.managerId ?? null;
  if (manager && manager !== requesterId) return manager;
  // Nobody in the chain: fall back to an administrator so a request is never stuck silently.
  const a = await tx.user.findFirst({ where: { role: 'ADMIN', active: true, deletedAt: null, id: { not: requesterId } }, orderBy: { createdAt: 'asc' } });
  return a?.id ?? null;
}

/* ── Ticket creation with the workspace fields ────────────────────────── */

export const detailInclude = {
  sla: true,
  asset: { select: { id: true, tag: true, model: true, ownerId: true } },
  category: true,
  requester: { select: person },
  assignee: { select: person },
  catalogItem: { select: { id: true, name: true, icon: true } },
  watchers: { select: { user: { select: person } } },
  approvals: { include: { approver: { select: person } }, orderBy: { createdAt: 'asc' as const } },
  attachments: { include: { uploader: { select: person } }, orderBy: { createdAt: 'asc' as const } },
  survey: { select: { score: true, comment: true, createdAt: true } },
} as const;

/** Full creation path shared by the classic form, catalog items and templates. */
export async function createTicket(res: Response, req: Request, clock: Clock = systemClock) {
  const data = ticketSchema.parse(req.body);
  const me = user(res);
  const now = clock.now();
  if (!(await db.category.findUnique({ where: { id: data.categoryId } }))) fail(400, 'Unknown category');
  return db.$transaction(async (tx) => {
    let formData: Record<string, string | number | boolean> | undefined;
    let item: { id: string; requiresApproval: boolean; approverKind: string; approverDepartmentId: string | null; type: 'INCIDENT' | 'REQUEST' | 'PROBLEM' | 'CHANGE'; priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'; name: string } | null = null;
    if (data.catalogItemId) {
      const found = await tx.catalogItem.findFirst({ where: { id: data.catalogItemId, active: true } });
      if (!found) fail(400, 'That catalog item is not available');
      const check = validateForm(found.fields as unknown as FormField[], data.formData);
      if (!check.ok) throw new HttpError(400, check.problems.join('. '));
      formData = check.data;
      item = found;
    }
    if (data.templateId && !(await tx.ticketTemplate.findFirst({ where: { id: data.templateId, active: true } }))) fail(400, 'Unknown template');
    await checkAssetLink(tx, me, data.assetId, me.id);
    const type = item?.type ?? data.type;
    const priority = data.priority ?? (item ? item.priority : priorityFor(data.impact, data.urgency));
    const top = await tx.ticket.aggregate({ _max: { rank: true } });
    const { templateId: _t, formData: _f, catalogItemId: _c, ...rest } = data;
    const ticket = await tx.ticket.create({
      data: {
        ...rest,
        dueAt: data.dueAt ? new Date(data.dueAt) : null,
        type,
        priority,
        createdAt: now,
        rank: (top._max.rank ?? 0) + 1,
        catalogItemId: item?.id ?? null,
        formData: formData ?? undefined,
        sla: { create: await newSla(tx, priority, now) },
        requesterId: me.id,
        watchers: { create: { userId: me.id } },
        events: { create: { actorId: me.id, action: 'CREATED', detail: item ? `Request "${item.name}" submitted from the catalog` : 'Ticket created' } },
      },
      include: detailInclude,
    });
    if (item?.requiresApproval) {
      const approverId = await resolveApprover(tx, item, me.id);
      if (approverId) {
        await tx.approval.create({ data: { ticketId: ticket.id, approverId } });
        await tx.event.create({ data: { ticketId: ticket.id, actorId: me.id, action: 'APPROVAL_REQUESTED', detail: `Approval requested from ${(await tx.user.findUnique({ where: { id: approverId }, select: { name: true } }))?.name ?? 'an approver'}` } });
        await enqueue(tx, ticket, 'APPROVAL_REQUESTED', `approval:${ticket.id}`, now, me.id, [approverId]);
        notifyUsers([approverId], { type: 'approval', ticketId: ticket.id });
      } else await tx.event.create({ data: { ticketId: ticket.id, actorId: me.id, action: 'APPROVAL_SKIPPED', detail: 'No approver could be resolved; request proceeds without approval' } });
      // Re-read so the response carries the approval that was just recorded.
      return tx.ticket.findUniqueOrThrow({ where: { id: ticket.id }, include: detailInclude });
    }
    return ticket;
  });
}

/* ── Mentions ─────────────────────────────────────────────────────────── */

/**
 * Finds `@Full Name` mentions. Names are matched against active accounts, longest first, so
 * "@Maya Chen" cannot be mistaken for a different "Maya". Only people who may read the ticket are
 * returned; mentioning someone does not grant access.
 */
export async function findMentions(tx: Tx, body: string, ticket: { id: string; requesterId: string }) {
  if (!body.includes('@')) return [];
  const candidates = await tx.user.findMany({ where: { active: true, deletedAt: null }, select: { id: true, name: true, role: true } });
  const lower = body.toLowerCase();
  const found = candidates
    .filter((u) => u.name.length >= 2)
    .sort((a, b) => b.name.length - a.name.length)
    .filter((u) => lower.includes(`@${u.name.toLowerCase()}`));
  const ok: typeof found = [];
  for (const u of found) if (await canAccess(tx, u, ticket)) ok.push(u);
  return ok;
}

/* ── Router ───────────────────────────────────────────────────────────── */

export const workspaceRouter = Router();

// Board: every active column with its tickets in rank order, scoped like the list.
workspaceRouter.get('/board', async (req, res) => {
  const me = user(res);
  const f = z.object({ q: z.string().max(160).default(''), assigned: z.enum(['mine', 'unassigned']).optional(), type: z.string().max(20).optional(), label: z.string().max(30).optional(), priority: z.string().max(10).optional(), categoryId: z.uuid().optional(), includeClosed: z.enum(['true']).optional() }).parse(req.query);
  const where: Prisma.TicketWhereInput = {
    ...(me.role === 'EMPLOYEE' ? { requesterId: me.id } : {}),
    ...(f.assigned ? { assigneeId: f.assigned === 'mine' ? me.id : null } : {}),
    ...(f.type ? { type: f.type as 'INCIDENT' } : {}),
    ...(f.priority ? { priority: f.priority as 'LOW' } : {}),
    ...(f.categoryId ? { categoryId: f.categoryId } : {}),
    ...(f.label ? { labels: { has: f.label.toLowerCase() } } : {}),
    ...(f.q ? { OR: [{ title: { contains: f.q, mode: 'insensitive' } }, ...(/^\d+$/.test(f.q) ? [{ number: Number(f.q) }] : [])] } : {}),
    ...(f.includeClosed ? {} : { status: { not: 'CLOSED' } }),
  };
  const tickets = await db.ticket.findMany({ where, include: { category: true, requester: { select: person }, assignee: { select: person }, sla: true, _count: { select: { attachments: true, replies: true } } }, orderBy: [{ rank: 'asc' }, { createdAt: 'desc' }], take: 500 });
  const columns = statuses.filter((s) => f.includeClosed || s !== 'CLOSED').map((status) => ({ status, tickets: tickets.filter((t) => t.status === status).map((t) => ({ ...t, sla: t.sla ? slaView(t.sla, new Date(), t.status) : null, attachmentCount: t._count.attachments, replyCount: t._count.replies, _count: undefined })), total: tickets.filter((t) => t.status === status).length }));
  res.json({ columns, labels: [...new Set(tickets.flatMap((t) => t.labels))].sort() });
});

// Move a card: new status and position. Employees cannot move cards (status is a support decision).
workspaceRouter.post('/board/move', staff, async (req, res) => {
  const { id, status, afterId } = z.object({ id: z.uuid(), status: z.enum(statuses), afterId: z.uuid().nullable().optional() }).strict().parse(req.body);
  const me = user(res);
  const ticket = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id = ${id} FOR UPDATE`;
    const current = await tx.ticket.findUnique({ where: { id } });
    if (!current) fail(404, 'Ticket not found');
    if (status !== current.status && !canTransition(current.status, status)) fail(409, `Cannot move from ${current.status} to ${status}`);
    let rank: number;
    if (afterId) {
      const after = await tx.ticket.findUnique({ where: { id: afterId }, select: { rank: true } });
      if (!after) fail(400, 'Unknown neighbour');
      const next = await tx.ticket.findFirst({ where: { status, rank: { gt: after.rank }, id: { not: id } }, orderBy: { rank: 'asc' }, select: { rank: true } });
      rank = next ? Math.floor((after.rank + next.rank) / 2) : after.rank + 1000;
      if (rank === after.rank) {
        // No room between neighbours: renumber the column with gaps and try again.
        const rows = await tx.ticket.findMany({ where: { status, id: { not: id } }, orderBy: { rank: 'asc' }, select: { id: true } });
        for (let i = 0; i < rows.length; i++) await tx.ticket.update({ where: { id: rows[i].id }, data: { rank: (i + 1) * 1000 } });
        const idx = rows.findIndex((r) => r.id === afterId);
        rank = (idx + 1) * 1000 + 500;
      }
    } else {
      const first = await tx.ticket.findFirst({ where: { status, id: { not: id } }, orderBy: { rank: 'asc' }, select: { rank: true } });
      rank = first ? first.rank - 1000 : 1000;
    }
    const updated = await tx.ticket.update({ where: { id }, data: { rank, status, version: { increment: 1 }, ...(status === 'RESOLVED' && current.status !== 'RESOLVED' ? { resolvedAt: new Date() } : {}), ...(status === 'CLOSED' ? { closedAt: new Date() } : {}), ...(status === 'OPEN' ? { resolvedAt: null, closedAt: null } : {}) }, include: detailInclude });
    if (status !== current.status) {
      await advanceSla(tx, id, status, new Date());
      await tx.event.create({ data: { ticketId: id, actorId: me.id, action: 'UPDATED', detail: `status: ${current.status} → ${status} (board)` } });
      await notifyWatchers(tx, updated, `status:${id}:${updated.version}`, me.id);
      if (status === 'RESOLVED') await enqueue(tx, updated, 'SURVEY_REQUEST', `survey:${id}`, new Date(), me.id, [updated.requesterId]);
    }
    return updated;
  });
  notifyUsers([ticket.requesterId, ...(ticket.assigneeId ? [ticket.assigneeId] : [])], { type: 'ticket', ticketId: id });
  res.json(ticket);
});

export async function notifyWatchers(tx: Tx, ticket: { id: string; requesterId: string; assigneeId: string | null }, key: string, actorId: string) {
  const watchers = await tx.watcher.findMany({ where: { ticketId: ticket.id }, select: { userId: true } });
  const ids = watchers.map((w) => w.userId).filter((id) => id !== actorId && id !== ticket.requesterId && id !== ticket.assigneeId);
  if (ids.length) await enqueue(tx, ticket, 'WATCHED_UPDATE', key, new Date(), actorId, ids);
}

// Bulk actions from the list or the board.
workspaceRouter.post('/tickets/bulk', staff, async (req, res) => {
  const data = bulkSchema.parse(req.body);
  const me = user(res);
  if (data.assigneeId) {
    const a = await db.user.findFirst({ where: { id: data.assigneeId, active: true, role: { in: ['ENGINEER', 'ADMIN'] } } });
    if (!a) fail(400, 'Assignee must be an active engineer or administrator');
  }
  if (data.categoryId && !(await db.category.findUnique({ where: { id: data.categoryId } }))) fail(400, 'Unknown category');
  const results = { updated: 0, skipped: [] as { id: string; reason: string }[] };
  for (const id of data.ids) {
    try {
      await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id = ${id} FOR UPDATE`;
        const current = await tx.ticket.findUnique({ where: { id } });
        if (!current) throw new HttpError(404, 'not found');
        if (data.status && data.status !== current.status && !canTransition(current.status, data.status)) throw new HttpError(409, `cannot move ${current.status} → ${data.status}`);
        const labels = [...new Set([...current.labels.filter((l) => !data.removeLabels?.includes(l)), ...(data.addLabels ?? [])])];
        const changes: string[] = [];
        if (data.status && data.status !== current.status) changes.push(`status: ${current.status} → ${data.status}`);
        if (data.priority && data.priority !== current.priority) changes.push(`priority: ${current.priority} → ${data.priority}`);
        if (data.assigneeId !== undefined && data.assigneeId !== current.assigneeId) changes.push(`assignee: ${current.assigneeId ?? 'none'} → ${data.assigneeId ?? 'none'}`);
        if (data.categoryId && data.categoryId !== current.categoryId) changes.push('category changed');
        if (labels.join() !== current.labels.join()) changes.push(`labels: ${labels.join(', ') || 'none'}`);
        if (!changes.length) return;
        const updated = await tx.ticket.update({ where: { id }, data: { ...(data.status ? { status: data.status } : {}), ...(data.priority ? { priority: data.priority } : {}), ...(data.assigneeId !== undefined ? { assigneeId: data.assigneeId } : {}), ...(data.categoryId ? { categoryId: data.categoryId } : {}), labels, version: { increment: 1 }, ...(data.status === 'RESOLVED' && current.status !== 'RESOLVED' ? { resolvedAt: new Date() } : {}), ...(data.status === 'CLOSED' ? { closedAt: new Date() } : {}) } });
        if (data.status && data.status !== current.status) await advanceSla(tx, id, data.status, new Date());
        await tx.event.create({ data: { ticketId: id, actorId: me.id, action: 'UPDATED', detail: `${changes.join('; ')} (bulk)` } });
        if (data.assigneeId && data.assigneeId !== current.assigneeId) await enqueue(tx, updated, 'ASSIGNMENT', `assignment:${id}:${updated.version}`, new Date());
        if (data.status === 'RESOLVED' && current.status !== 'RESOLVED') await enqueue(tx, updated, 'SURVEY_REQUEST', `survey:${id}`, new Date(), me.id, [updated.requesterId]);
        results.updated += 1;
      });
    } catch (e) {
      results.skipped.push({ id, reason: e instanceof HttpError ? e.message : 'failed' });
    }
  }
  await audit(db, { actorId: me.id, action: 'BULK_UPDATE', detail: `${results.updated} ticket(s) updated, ${results.skipped.length} skipped`, ip: clientIp(req) });
  res.json(results);
});

// Saved views: private by default, optionally shared with the whole workspace.
workspaceRouter.get('/views', async (_req, res) => {
  const me = user(res);
  res.json(await db.savedView.findMany({ where: { OR: [{ userId: me.id }, { shared: true }] }, include: { user: { select: person } }, orderBy: [{ shared: 'asc' }, { name: 'asc' }] }).then((rows) => rows.map((r) => ({ id: r.id, name: r.name, filters: r.filters, shared: r.shared, userId: r.userId, owner: r.user }))));
});
workspaceRouter.post('/views', async (req, res) => {
  const data = savedViewSchema.parse(req.body);
  const me = user(res);
  if (data.shared && me.role === 'EMPLOYEE') fail(403, 'Only support staff can share views');
  const view = await db.savedView.upsert({ where: { userId_name: { userId: me.id, name: data.name } }, create: { ...data, userId: me.id }, update: { filters: data.filters, shared: data.shared } });
  res.status(201).json(view);
});
workspaceRouter.delete('/views/:id', async (req, res) => {
  const deleted = await db.savedView.deleteMany({ where: { id: idOf(req), userId: user(res).id } });
  if (!deleted.count) fail(404, 'View not found');
  res.status(204).end();
});

// Labels in use, for pickers.
workspaceRouter.get('/labels', async (_req, res) => {
  const me = user(res);
  const rows = await db.ticket.findMany({ where: me.role === 'EMPLOYEE' ? { requesterId: me.id } : {}, select: { labels: true }, take: 2000 });
  const counts = new Map<string, number>();
  for (const r of rows) for (const l of r.labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  res.json([...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count })));
});

/* ── Catalog and templates ────────────────────────────────────────────── */

workspaceRouter.get('/catalog', async (_req, res) => res.json(await db.catalogItem.findMany({ where: { active: true }, include: { category: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })));
workspaceRouter.get('/catalog/:id', async (req, res) => {
  const item = await db.catalogItem.findFirst({ where: { id: idOf(req), ...(user(res).role === 'ADMIN' ? {} : { active: true }) }, include: { category: true } });
  if (!item) fail(404, 'Catalog item not found');
  res.json(item);
});
workspaceRouter.get('/admin/catalog', admin, async (_req, res) => res.json(await db.catalogItem.findMany({ include: { category: true, _count: { select: { tickets: true } } }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })));
workspaceRouter.post('/admin/catalog', admin, async (req, res) => {
  const data = catalogItemSchema.parse(req.body);
  if (!(await db.category.findUnique({ where: { id: data.categoryId } }))) fail(400, 'Unknown category');
  const item = await db.catalogItem.create({ data: { ...data, fields: data.fields as object[] } });
  await audit(db, { actorId: user(res).id, action: 'CATALOG_ITEM_CREATED', detail: `Catalog item "${item.name}" created`, ip: clientIp(req) });
  res.status(201).json(item);
});
workspaceRouter.put('/admin/catalog/:id', admin, async (req, res) => {
  const data = catalogItemSchema.parse(req.body);
  const id = idOf(req);
  if (!(await db.catalogItem.findUnique({ where: { id } }))) fail(404, 'Catalog item not found');
  const item = await db.catalogItem.update({ where: { id }, data: { ...data, fields: data.fields as object[] } });
  await audit(db, { actorId: user(res).id, action: 'CATALOG_ITEM_UPDATED', detail: `Catalog item "${item.name}" updated`, ip: clientIp(req) });
  res.json(item);
});

workspaceRouter.get('/templates', async (_req, res) => res.json(await db.ticketTemplate.findMany({ where: { active: true }, orderBy: { name: 'asc' } })));
workspaceRouter.get('/admin/templates', admin, async (_req, res) => res.json(await db.ticketTemplate.findMany({ orderBy: { name: 'asc' } })));
workspaceRouter.post('/admin/templates', admin, async (req, res) => {
  const data = templateSchema.parse(req.body);
  if (!(await db.category.findUnique({ where: { id: data.categoryId } }))) fail(400, 'Unknown category');
  res.status(201).json(await db.ticketTemplate.create({ data }));
});
workspaceRouter.put('/admin/templates/:id', admin, async (req, res) => {
  const data = templateSchema.parse(req.body);
  const id = idOf(req);
  if (!(await db.ticketTemplate.findUnique({ where: { id } }))) fail(404, 'Template not found');
  res.json(await db.ticketTemplate.update({ where: { id }, data }));
});

/* ── Approvals ────────────────────────────────────────────────────────── */

// `scope=approver` (default): decisions asked of me. `scope=requester`: approvals on tickets I raised,
// so a requester can follow their own request without seeing anyone else's queue.
workspaceRouter.get('/approvals', async (req, res) => {
  const f = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(), scope: z.enum(['approver', 'requester']).optional() }).parse(req.query);
  const me = user(res);
  const where = f.scope === 'requester' ? { ticket: { requesterId: me.id } } : { approverId: me.id };
  const rows = await db.approval.findMany({ where: { ...where, ...(f.status ? { status: f.status } : {}) }, include: { approver: { select: person }, ticket: { select: { id: true, number: true, title: true, status: true, type: true, createdAt: true, formData: true, requester: { select: person }, catalogItem: { select: { name: true, icon: true } } } } }, orderBy: { createdAt: 'desc' } });
  res.json(rows);
});
workspaceRouter.post('/tickets/:id/approvals/:approvalId/decide', async (req, res) => {
  const { decision, note } = approvalDecisionSchema.parse(req.body);
  const ticketId = idOf(req);
  const approvalId = z.uuid().parse(req.params.approvalId);
  const me = user(res);
  const ip = clientIp(req);
  const outcome = await db.$transaction(async (tx) => {
    // Serialise decisions per ticket: two approvers (or one person on two tabs) deciding at once
    // must produce one outcome and one 409, never an approval that is both granted and rejected.
    await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id = ${ticketId} FOR UPDATE`;
    const approval = await tx.approval.findFirst({ where: { id: approvalId, ticketId }, include: { ticket: true } });
    // Someone who cannot see the ticket learns nothing about its approvals.
    if (!approval || !(await canAccess(tx, me, approval.ticket))) fail(404, 'Approval not found');
    if (approval.approverId !== me.id && me.role !== 'ADMIN') fail(403, 'Only the named approver, or an administrator, can decide');
    if (approval.status !== 'PENDING') fail(409, 'This approval was already decided');
    const decided = await tx.approval.update({ where: { id: approvalId }, data: { status: decision, note: note ?? null, decidedAt: new Date() }, include: { approver: { select: person } } });
    await tx.event.create({ data: { ticketId, actorId: me.id, action: decision === 'APPROVED' ? 'APPROVAL_GRANTED' : 'APPROVAL_REJECTED', detail: `${decision === 'APPROVED' ? 'Approved' : 'Rejected'} by ${me.name}${note ? `: ${note}` : ''}`, internal: false, ip } });
    let ticket = approval.ticket;
    if (decision === 'REJECTED' && !['RESOLVED', 'CLOSED'].includes(ticket.status)) {
      ticket = await tx.ticket.update({ where: { id: ticketId }, data: { status: 'RESOLVED', resolvedAt: new Date(), version: { increment: 1 } } });
      await advanceSla(tx, ticketId, 'RESOLVED', new Date());
      await tx.event.create({ data: { ticketId, actorId: me.id, action: 'UPDATED', detail: 'status: request rejected → RESOLVED' } });
    }
    await enqueue(tx, ticket, 'APPROVAL_DECIDED', `approval:${approvalId}:${decision}`, new Date(), me.id, [ticket.requesterId]);
    return { decided, ticket };
  });
  notifyUsers([outcome.ticket.requesterId], { type: 'approval', ticketId });
  res.json(outcome.decided);
});

/* ── Watchers ─────────────────────────────────────────────────────────── */

async function loadForAccess(req: Request, res: Response) {
  const id = idOf(req);
  const ticket = await db.ticket.findUnique({ where: { id } });
  if (!ticket || !(await canAccess(db, user(res), ticket))) fail(404, 'Ticket not found');
  return ticket;
}

workspaceRouter.post('/tickets/:id/watch', async (req, res) => {
  const ticket = await loadForAccess(req, res);
  await db.watcher.upsert({ where: { ticketId_userId: { ticketId: ticket.id, userId: user(res).id } }, create: { ticketId: ticket.id, userId: user(res).id }, update: {} });
  res.status(204).end();
});
workspaceRouter.delete('/tickets/:id/watch', async (req, res) => {
  const ticket = await loadForAccess(req, res);
  await db.watcher.deleteMany({ where: { ticketId: ticket.id, userId: user(res).id } });
  res.status(204).end();
});
// Support staff can add a colleague as a watcher.
workspaceRouter.post('/tickets/:id/watchers', staff, async (req, res) => {
  const { userId } = z.object({ userId: z.uuid() }).strict().parse(req.body);
  const ticket = await loadForAccess(req, res);
  const target = await db.user.findFirst({ where: { id: userId, active: true, deletedAt: null } });
  if (!target || !(await canAccess(db, target, ticket))) fail(400, 'That person cannot see this ticket');
  await db.watcher.upsert({ where: { ticketId_userId: { ticketId: ticket.id, userId } }, create: { ticketId: ticket.id, userId }, update: {} });
  await db.event.create({ data: { ticketId: ticket.id, actorId: user(res).id, action: 'WATCHER_ADDED', detail: `${target.name} added as a watcher` } });
  res.status(204).end();
});

/* ── Attachments ──────────────────────────────────────────────────────── */

const ALLOWED = new Map<string, string[]>([
  ['.png', ['image/png']], ['.jpg', ['image/jpeg']], ['.jpeg', ['image/jpeg']], ['.gif', ['image/gif']], ['.webp', ['image/webp']],
  ['.pdf', ['application/pdf']], ['.txt', ['text/plain']], ['.log', ['text/plain', 'application/octet-stream']], ['.csv', ['text/csv', 'application/vnd.ms-excel', 'text/plain']],
  ['.docx', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']], ['.xlsx', ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']],
  ['.zip', ['application/zip', 'application/x-zip-compressed']],
]);
const MAGIC: [string, number[]][] = [['image/png', [0x89, 0x50, 0x4e, 0x47]], ['image/jpeg', [0xff, 0xd8, 0xff]], ['image/gif', [0x47, 0x49, 0x46, 0x38]], ['application/pdf', [0x25, 0x50, 0x44, 0x46]], ['application/zip', [0x50, 0x4b, 0x03, 0x04]]];

const uploadDir = resolve(config.UPLOAD_DIR);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.ATTACHMENT_MAX_MB * 1024 * 1024, files: 1 } });

function checkFile(file: Express.Multer.File) {
  const ext = extname(file.originalname).toLowerCase();
  const allowed = ALLOWED.get(ext);
  if (!allowed) fail(400, `File type ${ext || '(none)'} is not allowed. Allowed: ${[...ALLOWED.keys()].join(' ')}`);
  const declared = file.mimetype.toLowerCase();
  if (!allowed.includes(declared)) fail(400, `Content type ${declared} does not match a ${ext} file`);
  const magic = MAGIC.find(([m]) => allowed.includes(m) || (m === 'application/zip' && ['.docx', '.xlsx', '.zip'].includes(ext)));
  if (magic && !magic[1].every((b, i) => file.buffer[i] === b)) fail(400, 'The file contents do not match its extension');
  if (file.buffer.length === 0) fail(400, 'The file is empty');
  return { ext, mime: ['.docx', '.xlsx'].includes(ext) ? allowed[0] : declared };
}

workspaceRouter.post('/tickets/:id/attachments', uploadLimit, (req, res, next) => upload.single('file')(req, res, (err) => (err ? next(new HttpError(400, err.code === 'LIMIT_FILE_SIZE' ? `Files are limited to ${config.ATTACHMENT_MAX_MB} MB` : 'Upload rejected')) : next())), async (req, res) => {
  const ticket = await loadForAccess(req, res);
  if (['CLOSED'].includes(ticket.status)) fail(409, 'This ticket is closed');
  const file = req.file;
  if (!file) fail(400, 'Attach a file in the "file" field');
  const { ext, mime } = checkFile(file);
  const sha256 = createHash('sha256').update(file.buffer).digest('hex');
  const storageKey = `${ticket.id}/${randomBytes(16).toString('hex')}${ext}`;
  mkdirSync(resolve(uploadDir, ticket.id), { recursive: true });
  await writeFile(resolve(uploadDir, storageKey), file.buffer);
  const safeName = basename(file.originalname).replace(/[\r\n"\\]/g, '_').slice(0, 160);
  const row = await db.attachment.create({ data: { ticketId: ticket.id, uploaderId: user(res).id, filename: safeName, mime, size: file.buffer.length, sha256, storageKey }, include: { uploader: { select: person } } });
  await db.event.create({ data: { ticketId: ticket.id, actorId: user(res).id, action: 'ATTACHMENT_ADDED', detail: `${safeName} (${Math.round(file.buffer.length / 1024)} KB)`, internal: false } });
  await db.$transaction((tx) => notifyWatchers(tx, ticket, `attachment:${row.id}`, user(res).id));
  notifyUsers([ticket.requesterId, ...(ticket.assigneeId ? [ticket.assigneeId] : [])], { type: 'ticket', ticketId: ticket.id });
  res.status(201).json(row);
});

workspaceRouter.get('/tickets/:id/attachments/:attachmentId', async (req, res) => {
  const ticket = await loadForAccess(req, res);
  const attachment = await db.attachment.findFirst({ where: { id: z.uuid().parse(req.params.attachmentId), ticketId: ticket.id } });
  if (!attachment) fail(404, 'Attachment not found');
  const path = resolve(uploadDir, attachment.storageKey);
  if (!path.startsWith(uploadDir) || !existsSync(path)) fail(404, 'The file is no longer available');
  // Always a download, never rendered in the page: no inline HTML/SVG, no script execution.
  res.setHeader('Content-Type', attachment.mime);
  res.setHeader('Content-Length', String(attachment.size));
  res.setHeader('Content-Disposition', `attachment; filename="${attachment.filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  createReadStream(path).pipe(res);
});

workspaceRouter.delete('/tickets/:id/attachments/:attachmentId', async (req, res) => {
  const ticket = await loadForAccess(req, res);
  const attachment = await db.attachment.findFirst({ where: { id: z.uuid().parse(req.params.attachmentId), ticketId: ticket.id } });
  if (!attachment) fail(404, 'Attachment not found');
  const me = user(res);
  if (attachment.uploaderId !== me.id && me.role !== 'ADMIN') fail(403, 'Only the uploader or an administrator can remove a file');
  await db.attachment.delete({ where: { id: attachment.id } });
  await unlink(resolve(uploadDir, attachment.storageKey)).catch(() => {});
  await db.event.create({ data: { ticketId: ticket.id, actorId: me.id, action: 'ATTACHMENT_REMOVED', detail: attachment.filename, internal: false } });
  res.status(204).end();
});

/* ── Comment editing ──────────────────────────────────────────────────── */

const EDIT_WINDOW_MS = 15 * 60 * 1000;
workspaceRouter.patch('/tickets/:id/replies/:replyId', async (req, res) => {
  const { body } = z.object({ body: z.string().trim().min(1).max(10000) }).strict().parse(req.body);
  const ticket = await loadForAccess(req, res);
  const reply = await db.reply.findFirst({ where: { id: z.uuid().parse(req.params.replyId), ticketId: ticket.id, internal: false } });
  if (!reply) fail(404, 'Reply not found');
  const me = user(res);
  if (reply.authorId !== me.id) fail(403, 'You can only edit your own replies');
  if (Date.now() - reply.createdAt.getTime() > EDIT_WINDOW_MS && me.role === 'EMPLOYEE') fail(409, 'Replies can be edited for fifteen minutes after posting');
  const updated = await db.reply.update({ where: { id: reply.id }, data: { body, editedAt: new Date() }, include: { author: { select: person }, mentions: { select: person } } });
  await db.event.create({ data: { ticketId: ticket.id, actorId: me.id, action: 'REPLY_EDITED', detail: `Reply ${reply.id} edited`, internal: true } });
  res.json(updated);
});

/* ── Activity stream ──────────────────────────────────────────────────── */

workspaceRouter.get('/tickets/:id/activity', async (req, res) => {
  const ticket = await loadForAccess(req, res);
  const me = user(res);
  const isStaff = me.role !== 'EMPLOYEE';
  const [events, replies, attachments, approvals] = await Promise.all([
    db.event.findMany({ where: { ticketId: ticket.id, ...(isStaff ? {} : { internal: false }) }, include: { actor: { select: person } }, orderBy: { createdAt: 'asc' } }),
    db.reply.findMany({ where: { ticketId: ticket.id, ...(isStaff ? {} : { internal: false }) }, include: { author: { select: person } }, orderBy: { createdAt: 'asc' } }),
    db.attachment.findMany({ where: { ticketId: ticket.id }, include: { uploader: { select: person } } }),
    db.approval.findMany({ where: { ticketId: ticket.id }, include: { approver: { select: person } } }),
  ]);
  const items = [
    ...events.map((e) => ({ id: e.id, kind: 'event' as const, at: e.createdAt, actor: e.actor, title: e.detail, internal: e.internal })),
    ...replies.map((r) => ({ id: r.id, kind: r.internal ? ('note' as const) : ('reply' as const), at: r.createdAt, actor: r.author, title: r.internal ? 'Internal note' : 'Reply', body: r.body, internal: r.internal })),
    ...attachments.map((a) => ({ id: a.id, kind: 'attachment' as const, at: a.createdAt, actor: a.uploader, title: `Attached ${a.filename}`, internal: false })),
    ...approvals.map((a) => ({ id: a.id, kind: 'approval' as const, at: a.decidedAt ?? a.createdAt, actor: a.approver, title: a.status === 'PENDING' ? 'Approval pending' : `${a.status === 'APPROVED' ? 'Approved' : 'Rejected'}${a.note ? `: ${a.note}` : ''}`, internal: false })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));
  res.json(items);
});

/* ── Satisfaction ─────────────────────────────────────────────────────── */

workspaceRouter.post('/tickets/:id/survey', async (req, res) => {
  const data = surveySchema.parse(req.body);
  const ticket = await loadForAccess(req, res);
  const me = user(res);
  if (ticket.requesterId !== me.id) fail(403, 'Only the requester can rate a ticket');
  if (!['RESOLVED', 'CLOSED'].includes(ticket.status)) fail(409, 'Rate the ticket once it is resolved');
  if (await db.survey.findUnique({ where: { ticketId: ticket.id } })) fail(409, 'This ticket has already been rated');
  const survey = await db.survey.create({ data: { ticketId: ticket.id, respondentId: me.id, score: data.score, comment: data.comment || null } });
  await db.event.create({ data: { ticketId: ticket.id, actorId: me.id, action: 'SURVEY_SUBMITTED', detail: `Rated ${data.score}/5${data.comment ? ' with a comment' : ''}`, internal: false } });
  await db.outbox.updateMany({ where: { ticketId: ticket.id, kind: 'SURVEY_REQUEST', recipientId: me.id, readAt: null }, data: { readAt: new Date() } });
  res.status(201).json(survey);
});

/* ── Quick search across the workspace (command palette) ──────────────── */

workspaceRouter.get('/search', searchLimit, async (req, res) => {
  const { q } = z.object({ q: z.string().trim().max(120).default('') }).parse(req.query);
  const me = user(res);
  if (q.length < 2) return res.json({ tickets: [], assets: [], articles: [], people: [], departments: [], services: [] });
  const isStaff = me.role !== 'EMPLOYEE';
  // Every branch keeps the scope its own module uses: an employee's search reaches their own
  // tickets and assets, employee-visible articles, and the directory — never anything else.
  const [tickets, assets, articles, people, departments, services] = await Promise.all([
    // A ticket key ("OPS-0012", "ops 12", "12") is an exact lookup and comes first; titles follow.
    (async () => {
      const keyMatch = q.match(/^(?:ops[-\s]?)?0*(\d{1,6})$/i);
      const scope = isStaff ? {} : { requesterId: me.id };
      const select = { id: true, number: true, title: true, status: true, type: true, catalogItemId: true } as const;
      const exact = keyMatch ? await db.ticket.findMany({ where: { ...scope, number: Number(keyMatch[1]) }, select }) : [];
      const byTitle = await db.ticket.findMany({ where: { ...scope, title: { contains: q, mode: 'insensitive' }, ...(exact.length ? { id: { notIn: exact.map((t) => t.id) } } : {}) }, select, orderBy: { updatedAt: 'desc' }, take: 6 - exact.length });
      return [...exact, ...byTitle];
    })(),
    db.asset.findMany({ where: { ...(isStaff ? {} : { ownerId: me.id }), OR: [{ tag: { contains: q, mode: 'insensitive' } }, { model: { contains: q, mode: 'insensitive' } }, { serialNumber: { contains: q, mode: 'insensitive' } }] }, select: { id: true, tag: true, model: true, type: true, status: true, owner: { select: person } }, take: 5 }),
    db.article.findMany({ where: { status: 'PUBLISHED', ...(isStaff ? {} : { visibility: 'EMPLOYEE' }), OR: [{ title: { contains: q, mode: 'insensitive' } }, { markdown: { contains: q, mode: 'insensitive' } }] }, select: { id: true, title: true, visibility: true, updatedAt: true, category: { select: { id: true, name: true } } }, take: 5 }),
    db.user.findMany({ where: { active: true, deletedAt: null, OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, { title: { contains: q, mode: 'insensitive' } }] }, select: { ...person, title: true, department: { select: { id: true, name: true } } }, take: 5, orderBy: { name: 'asc' } }),
    db.department.findMany({ where: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }] }, select: { id: true, name: true, code: true, _count: { select: { members: { where: { active: true, deletedAt: null } } } } }, take: 4, orderBy: { name: 'asc' } }),
    db.catalogItem.findMany({ where: { active: true, OR: [{ name: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] }, select: { id: true, name: true, description: true, icon: true, requiresApproval: true }, take: 4, orderBy: { sortOrder: 'asc' } }),
  ]);
  res.json({ tickets, assets, articles, people, departments: departments.map((d) => ({ id: d.id, name: d.name, code: d.code, memberCount: d._count.members })), services });
});

/** People who can be @mentioned on a ticket: those who can read it. */
workspaceRouter.get('/tickets/:id/mentionable', async (req, res) => {
  const ticket = await loadForAccess(req, res);
  const { q } = z.object({ q: z.string().trim().max(60).default('') }).parse(req.query);
  const rows = await db.user.findMany({ where: { active: true, deletedAt: null, ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}) }, select: person, orderBy: { name: 'asc' }, take: 50 });
  const ok: typeof rows = [];
  for (const u of rows) if (await canAccess(db, u, ticket)) ok.push(u);
  res.json(ok.slice(0, 8));
});
