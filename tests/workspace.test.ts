import 'dotenv/config';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { db } from '../server/db.js';
import { config } from '../server/config.js';
import { hashPassword } from '../server/password.js';
import { priorityFor } from '../shared/model.js';
import { validateForm } from '../server/workspace.js';

if (config.NODE_ENV !== 'test' || !new URL(config.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Integration tests require NODE_ENV=test and a database name ending in _test');

const app = createApp();
const origin = config.APP_ORIGIN;
const tag = randomUUID();
const short = tag.slice(0, 8);
const password = 'Synthetic-workspace-password-2026';
const ids: string[] = [];
const agents = { employee: request.agent(app), other: request.agent(app), engineer: request.agent(app), admin: request.agent(app), manager: request.agent(app) };
const csrf: Record<string, string> = {};
const userId: Record<string, string> = {};
let categoryId = '';
let departmentId = '';
const cleanupTickets: string[] = [];

const post = (who: keyof typeof agents, path: string, body: unknown) => agents[who].post(`/api${path}`).set('Origin', origin).set('X-CSRF-Token', csrf[who]).send(body as object);
const patch = (who: keyof typeof agents, path: string, body: unknown) => agents[who].patch(`/api${path}`).set('Origin', origin).set('X-CSRF-Token', csrf[who]).send(body as object);
const del = (who: keyof typeof agents, path: string) => agents[who].delete(`/api${path}`).set('Origin', origin).set('X-CSRF-Token', csrf[who]);

beforeAll(async () => {
  const hash = await hashPassword(password);
  for (const [name, role] of [['employee', 'EMPLOYEE'], ['other', 'EMPLOYEE'], ['manager', 'EMPLOYEE'], ['engineer', 'ENGINEER'], ['admin', 'ADMIN']] as const) {
    const u = await db.user.create({ data: { email: `ws-${name}-${tag}@example.test`, name: `Ws ${name[0].toUpperCase()}${name.slice(1)}`, passwordHash: hash, role } });
    ids.push(u.id);
    userId[name] = u.id;
    const r = await agents[name].post('/api/auth/login').set('Origin', origin).send({ email: u.email, password }).expect(200);
    csrf[name] = r.body.csrfToken;
  }
  categoryId = (await db.category.create({ data: { name: `Ws ${tag}` } })).id;
  departmentId = (await db.department.create({ data: { name: `Ws dept ${tag}`, code: `W${tag.slice(0, 6).toUpperCase()}`, managerId: userId.manager } })).id;
  await db.user.update({ where: { id: userId.employee }, data: { departmentId, managerId: userId.manager } });
});
afterAll(async () => {
  const mine = (await db.ticket.findMany({ where: { OR: [{ id: { in: cleanupTickets } }, { requesterId: { in: ids } }] }, select: { id: true } })).map((t) => t.id);
  await db.event.deleteMany({ where: { OR: [{ ticketId: { in: mine } }, { actorId: { in: ids } }] } });
  await db.reply.deleteMany({ where: { ticketId: { in: mine } } });
  await db.ticketSla.deleteMany({ where: { ticketId: { in: mine } } });
  await db.ticket.deleteMany({ where: { id: { in: mine } } });
  await db.catalogItem.deleteMany({ where: { name: { contains: tag } } });
  await db.ticketTemplate.deleteMany({ where: { name: { contains: tag } } });
  await db.category.deleteMany({ where: { id: categoryId } });
  await db.department.deleteMany({ where: { id: departmentId } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

const create = async (who: keyof typeof agents, extra: Record<string, unknown> = {}) => {
  const r = await post(who, '/tickets', { title: `Ws ticket ${tag} ${Math.random().toString(36).slice(2, 7)}`, description: 'A synthetic ticket for the workspace suite, long enough to pass validation.', categoryId, ...extra }).expect(201);
  cleanupTickets.push(r.body.id);
  return r.body;
};

describe('priority matrix, types, labels and due dates', () => {
  it('derives priority from impact and urgency, and staff can override', () => {
    expect(priorityFor('HIGH', 'HIGH')).toBe('URGENT');
    expect(priorityFor('HIGH', 'MEDIUM')).toBe('HIGH');
    expect(priorityFor('MEDIUM', 'MEDIUM')).toBe('MEDIUM');
    expect(priorityFor('LOW', 'HIGH')).toBe('MEDIUM');
    expect(priorityFor('LOW', 'LOW')).toBe('LOW');
  });
  it('a ticket carries type, impact, urgency, labels and a due date; the requester follows it automatically', async () => {
    const t = await create('employee', { type: 'INCIDENT', impact: 'HIGH', urgency: 'HIGH', labels: ['VPN', 'remote work'], dueAt: new Date(Date.now() + 86400000).toISOString() });
    expect(t.priority).toBe('URGENT');
    expect(t.labels).toEqual(['vpn', 'remote work']);
    expect(t.watching).toBe(true);
    expect(t.type).toBe('INCIDENT');
    const detail = await agents.employee.get(`/api/tickets/${t.id}`).expect(200);
    expect(detail.body.watchers.map((w: { id: string }) => w.id)).toContain(userId.employee);
    expect(detail.body.requesterProfile.email).toContain('ws-employee');
    const other = await agents.other.get(`/api/tickets/${t.id}`).expect(404);
    expect(other.body.error).toBe('Ticket not found');
  });
  it('changing impact or urgency re-derives the priority unless one is named', async () => {
    const t = await create('employee', { impact: 'LOW', urgency: 'LOW' });
    expect(t.priority).toBe('LOW');
    const r1 = await patch('engineer', `/tickets/${t.id}`, { version: t.version, urgency: 'HIGH' }).expect(200);
    expect(r1.body.priority).toBe('MEDIUM');
    const r2 = await patch('engineer', `/tickets/${t.id}`, { version: r1.body.version, impact: 'HIGH', priority: 'LOW' }).expect(200);
    expect(r2.body.priority).toBe('LOW');
    await patch('employee', `/tickets/${t.id}`, { version: r2.body.version, labels: ['x'] }).expect(403);
    const bad = await post('employee', '/tickets', { title: 'Label validation ticket', description: 'Labels with punctuation other than - _ . / are refused.', categoryId, labels: ['bad;label'] }).expect(400);
    expect(bad.body.error).toBe('Invalid request');
  });
  it('the list filters by type, label and watching', async () => {
    const t = await create('employee', { type: 'CHANGE', labels: [`only-${tag.slice(0, 6)}`] });
    const byType = await agents.engineer.get('/api/tickets?type=CHANGE&pageSize=100').expect(200);
    expect(byType.body.items.some((x: { id: string }) => x.id === t.id)).toBe(true);
    const byLabel = await agents.engineer.get(`/api/tickets?label=only-${tag.slice(0, 6)}`).expect(200);
    expect(byLabel.body.items.map((x: { id: string }) => x.id)).toEqual([t.id]);
    const watching = await agents.employee.get('/api/tickets?watching=true&pageSize=100').expect(200);
    expect(watching.body.items.some((x: { id: string }) => x.id === t.id)).toBe(true);
    const labels = await agents.engineer.get('/api/labels').expect(200);
    expect(labels.body.some((l: { label: string }) => l.label === `only-${tag.slice(0, 6)}`)).toBe(true);
  });
});

describe('board, moves, bulk actions and saved views', () => {
  it('groups tickets by status, respects the workflow when moving, and keeps order', async () => {
    const a = await create('employee');
    const b = await create('employee');
    const board = await agents.engineer.get('/api/board').expect(200);
    const open = board.body.columns.find((c: { status: string }) => c.status === 'OPEN');
    expect(open.tickets.map((t: { id: string }) => t.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(open.tickets[0].sla.remainingResponseMs).toBeTypeOf('number');
    // OPEN → RESOLVED is not allowed; OPEN → IN_PROGRESS is.
    const refused = await post('engineer', '/board/move', { id: a.id, status: 'RESOLVED', afterId: null }).expect(409);
    expect(refused.body.error).toContain('Cannot move');
    const moved = await post('engineer', '/board/move', { id: a.id, status: 'IN_PROGRESS', afterId: null }).expect(200);
    expect(moved.body.status).toBe('IN_PROGRESS');
    await post('engineer', '/board/move', { id: b.id, status: 'IN_PROGRESS', afterId: a.id }).expect(200);
    const after = await agents.engineer.get('/api/board').expect(200);
    const col = after.body.columns.find((c: { status: string }) => c.status === 'IN_PROGRESS').tickets.map((t: { id: string }) => t.id);
    expect(col.indexOf(a.id)).toBeLessThan(col.indexOf(b.id));
    // Reorder: b before a.
    await post('engineer', '/board/move', { id: b.id, status: 'IN_PROGRESS', afterId: null }).expect(200);
    const again = await agents.engineer.get('/api/board').expect(200);
    const col2 = again.body.columns.find((c: { status: string }) => c.status === 'IN_PROGRESS').tickets.map((t: { id: string }) => t.id);
    expect(col2.indexOf(b.id)).toBeLessThan(col2.indexOf(a.id));
    await post('employee', '/board/move', { id: a.id, status: 'OPEN', afterId: null }).expect(403);
    const employeeBoard = await agents.employee.get('/api/board').expect(200);
    expect(employeeBoard.body.columns.flatMap((c: { tickets: { requesterId: string }[] }) => c.tickets).every((t: { requesterId: string }) => t.requesterId === userId.employee)).toBe(true);
  });
  it('bulk updates apply per ticket, report skips, and are audited', async () => {
    const a = await create('employee');
    const b = await create('employee');
    const c = await create('employee');
    await post('engineer', '/board/move', { id: c.id, status: 'IN_PROGRESS', afterId: null }).expect(200);
    const r = await post('engineer', '/tickets/bulk', { ids: [a.id, b.id, c.id], status: 'IN_PROGRESS', assigneeId: userId.engineer, addLabels: ['Bulk'] }).expect(200);
    expect(r.body.updated).toBe(3);
    const bad = await post('engineer', '/tickets/bulk', { ids: [a.id, c.id], status: 'CLOSED' }).expect(200);
    expect(bad.body.updated).toBe(0);
    expect(bad.body.skipped).toHaveLength(2);
    const row = await db.ticket.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.labels).toContain('bulk');
    expect(row.assigneeId).toBe(userId.engineer);
    expect(await db.event.count({ where: { actorId: userId.engineer, action: 'BULK_UPDATE' } })).toBeGreaterThanOrEqual(2);
    await post('employee', '/tickets/bulk', { ids: [a.id], status: 'OPEN' }).expect(403);
  });
  it('saved views are private unless shared by staff, and upsert by name', async () => {
    const mine = await post('employee', '/views', { name: `Mine ${short}`, filters: { type: 'INCIDENT' } }).expect(201);
    await post('employee', '/views', { name: `Mine ${short}`, filters: { type: 'CHANGE' } }).expect(201);
    const mineList = await agents.employee.get('/api/views').expect(200);
    expect(mineList.body.filter((v: { id: string }) => v.id === mine.body.id)).toHaveLength(1);
    expect(mineList.body.find((v: { id: string }) => v.id === mine.body.id).filters).toEqual({ type: 'CHANGE' });
    await post('employee', '/views', { name: `Shared ${short}`, filters: {}, shared: true }).expect(403);
    const shared = await post('engineer', '/views', { name: `Team ${short}`, filters: { assigned: 'unassigned' }, shared: true }).expect(201);
    const otherList = await agents.other.get('/api/views').expect(200);
    expect(otherList.body.some((v: { id: string }) => v.id === shared.body.id)).toBe(true);
    expect(otherList.body.some((v: { id: string }) => v.id === mine.body.id)).toBe(false);
    await del('other', `/views/${shared.body.id}`).expect(404);
    await del('engineer', `/views/${shared.body.id}`).expect(204);
    await del('employee', `/views/${mine.body.id}`).expect(204);
  });
});

describe('service catalog and approvals', () => {
  it('validates a dynamic form against its schema', () => {
    const fields = [{ key: 'model', label: 'Model', kind: 'select' as const, required: true, options: ['A', 'B'] }, { key: 'when', label: 'When', kind: 'date' as const }, { key: 'ok', label: 'OK', kind: 'checkbox' as const }, { key: 'n', label: 'N', kind: 'number' as const }];
    expect(validateForm(fields, { model: 'A', when: '2026-10-01', ok: true, n: '3' })).toEqual({ ok: true, problems: [], data: { model: 'A', when: '2026-10-01', ok: true, n: 3 } });
    const bad = validateForm(fields, { model: 'Z', when: 'tomorrow', n: 'x', extra: 1 });
    expect(bad.ok).toBe(false);
    expect(bad.problems.join(' ')).toMatch(/Model must be one of/);
    expect(bad.problems.join(' ')).toMatch(/When must be a date/);
    expect(bad.problems.join(' ')).toMatch(/N must be a number/);
    expect(bad.problems.join(' ')).toMatch(/Unexpected field/);
    expect(validateForm(fields, {}).problems).toEqual(['Model is required']);
  });
  let itemId = '';
  let ticketId = '';
  let approvalId = '';
  it('an administrator publishes a catalog item with a form and an approval rule', async () => {
    await post('engineer', '/admin/catalog', { name: `Item ${tag}`, description: 'x'.repeat(10), categoryId }).expect(403);
    const badKeys = await post('admin', '/admin/catalog', { name: `Dup ${tag}`, description: 'Duplicate keys are refused', categoryId, fields: [{ key: 'a', label: 'A', kind: 'text' }, { key: 'a', label: 'B', kind: 'text' }] }).expect(400);
    expect(JSON.stringify(badKeys.body)).toContain('unique');
    const r = await post('admin', '/admin/catalog', { name: `Laptop ${tag}`, description: 'A laptop for a new starter or a replacement.', icon: 'laptop', type: 'REQUEST', categoryId, priority: 'HIGH', requiresApproval: true, approverKind: 'MANAGER', fields: [{ key: 'model', label: 'Model', kind: 'select', required: true, options: ['Standard', 'Developer'] }, { key: 'reason', label: 'Reason', kind: 'textarea', required: true }] }).expect(201);
    itemId = r.body.id;
    const list = await agents.employee.get('/api/catalog').expect(200);
    expect(list.body.some((c: { id: string }) => c.id === itemId)).toBe(true);
  });
  it('a request from the catalog validates the form, inherits type and priority, and routes to the manager', async () => {
    const missing = await post('employee', '/tickets', { title: `Laptop please ${tag}`, description: 'Requested through the catalog for the workspace suite.', categoryId, catalogItemId: itemId, formData: { model: 'Standard' } }).expect(400);
    expect(missing.body.error).toContain('Reason is required');
    const r = await post('employee', '/tickets', { title: `Laptop please ${tag}`, description: 'Requested through the catalog for the workspace suite.', categoryId, catalogItemId: itemId, formData: { model: 'Developer', reason: 'Joining the platform team' } }).expect(201);
    cleanupTickets.push(r.body.id);
    ticketId = r.body.id;
    expect(r.body.type).toBe('REQUEST');
    expect(r.body.priority).toBe('HIGH');
    expect(r.body.approvals).toHaveLength(1);
    expect(r.body.approvals[0].approver.id).toBe(userId.manager);
    approvalId = r.body.approvals[0].id;
    // The manager (an employee, not the requester) can now see the request and is notified.
    await agents.manager.get(`/api/tickets/${ticketId}`).expect(200);
    await agents.other.get(`/api/tickets/${ticketId}`).expect(404);
    const inbox = await agents.manager.get('/api/notifications').expect(200);
    expect(inbox.body.items.some((n: { kind: string; ticketId: string }) => n.kind === 'APPROVAL_REQUESTED' && n.ticketId === ticketId)).toBe(true);
    const queue = await agents.manager.get('/api/approvals?status=PENDING').expect(200);
    expect(queue.body.map((a: { id: string }) => a.id)).toContain(approvalId);
    // The requester follows their own request through scope=requester; it never appears in their approver queue,
    // and an unrelated employee sees neither.
    const mineAsApprover = await agents.employee.get('/api/approvals').expect(200);
    expect(mineAsApprover.body.map((a: { id: string }) => a.id)).not.toContain(approvalId);
    const requested = await agents.employee.get('/api/approvals?scope=requester').expect(200);
    expect(requested.body.map((a: { id: string }) => a.id)).toContain(approvalId);
    expect(requested.body[0].approver.id).toBe(userId.manager);
    const otherRequested = await agents.other.get('/api/approvals?scope=requester').expect(200);
    expect(otherRequested.body.map((a: { id: string }) => a.id)).not.toContain(approvalId);
  });
  it('only the named approver or an administrator may decide, once; a rejection resolves the request', async () => {
    await post('other', `/tickets/${ticketId}/approvals/${approvalId}/decide`, { decision: 'APPROVED' }).expect(404);
    await post('engineer', `/tickets/${ticketId}/approvals/${approvalId}/decide`, { decision: 'APPROVED' }).expect(403);
    const decided = await post('manager', `/tickets/${ticketId}/approvals/${approvalId}/decide`, { decision: 'REJECTED', note: 'Budget frozen this quarter' }).expect(200);
    expect(decided.body.status).toBe('REJECTED');
    await post('manager', `/tickets/${ticketId}/approvals/${approvalId}/decide`, { decision: 'APPROVED' }).expect(409);
    const t = await agents.employee.get(`/api/tickets/${ticketId}`).expect(200);
    expect(t.body.status).toBe('RESOLVED');
    const inbox = await agents.employee.get('/api/notifications').expect(200);
    expect(inbox.body.items.some((n: { kind: string }) => n.kind === 'APPROVAL_DECIDED')).toBe(true);
    const activity = await agents.employee.get(`/api/tickets/${ticketId}/activity`).expect(200);
    expect(activity.body.some((a: { kind: string; title: string }) => a.kind === 'approval' && a.title.includes('Budget frozen'))).toBe(true);
  });
  it('falls back to an administrator when the requester has no manager, and templates prefill', async () => {
    const r = await post('other', '/tickets', { title: `Laptop for other ${tag}`, description: 'Requested by someone without a manager on file.', categoryId, catalogItemId: itemId, formData: { model: 'Standard', reason: 'Replacement' } }).expect(201);
    cleanupTickets.push(r.body.id);
    expect(r.body.approvals[0].approver.role).toBe('ADMIN');
    const tpl = await post('admin', '/admin/templates', { name: `Tpl ${tag}`, title: 'Printer offline again', description: 'Which printer? What does the display say? Since when?', categoryId, priority: 'LOW', type: 'INCIDENT' }).expect(201);
    const visible = await agents.employee.get('/api/templates').expect(200);
    expect(visible.body.some((t: { id: string }) => t.id === tpl.body.id)).toBe(true);
    const fromTpl = await create('employee', { templateId: tpl.body.id, type: 'INCIDENT' });
    expect(fromTpl.type).toBe('INCIDENT');
  });
});

describe('collaboration', () => {
  let ticketId = '';
  it('watchers: follow, unfollow, staff add a colleague, and followers hear about status changes', async () => {
    const t = await create('employee');
    ticketId = t.id;
    await post('engineer', `/tickets/${t.id}/watch`, {}).expect(204);
    await post('engineer', `/tickets/${t.id}/watchers`, { userId: userId.other }).expect(400); // cannot read it
    await post('engineer', `/tickets/${t.id}/watchers`, { userId: userId.admin }).expect(204);
    const detail = await agents.engineer.get(`/api/tickets/${t.id}`).expect(200);
    expect(detail.body.watchers.map((w: { id: string }) => w.id).sort()).toEqual([userId.admin, userId.employee, userId.engineer].sort());
    expect(detail.body.watching).toBe(true);
    await patch('admin', `/tickets/${t.id}`, { version: t.version, status: 'IN_PROGRESS' }).expect(200);
    const inbox = await agents.engineer.get('/api/notifications').expect(200);
    expect(inbox.body.items.some((n: { kind: string; ticketId: string }) => n.kind === 'WATCHED_UPDATE' && n.ticketId === t.id)).toBe(true);
    await del('engineer', `/tickets/${t.id}/watch`).expect(204);
    const after = await agents.engineer.get(`/api/tickets/${t.id}`).expect(200);
    expect(after.body.watching).toBe(false);
  });
  it('@mentions notify people who can read the ticket, and nobody else', async () => {
    const r = await post('employee', `/tickets/${ticketId}/replies`, { body: `Thanks @Ws Engineer and @Ws Other, please look at this.` }).expect(201);
    expect(r.body.mentions.map((m: { id: string }) => m.id)).toEqual([userId.engineer]);
    const inbox = await agents.engineer.get('/api/notifications').expect(200);
    expect(inbox.body.items.some((n: { kind: string; ticketId: string }) => n.kind === 'MENTION' && n.ticketId === ticketId)).toBe(true);
    const otherInbox = await agents.other.get('/api/notifications').expect(200);
    expect(otherInbox.body.items.some((n: { ticketId: string }) => n.ticketId === ticketId)).toBe(false);
    const mentionable = await agents.employee.get(`/api/tickets/${ticketId}/mentionable?q=Ws`).expect(200);
    expect(mentionable.body.map((p: { id: string }) => p.id)).not.toContain(userId.other);
  });
  it('a reply can be edited by its author within the window; others cannot', async () => {
    const r = await post('employee', `/tickets/${ticketId}/replies`, { body: 'Original wording' }).expect(201);
    await patch('engineer', `/tickets/${ticketId}/replies/${r.body.id}`, { body: 'Hijacked' }).expect(403);
    const edited = await patch('employee', `/tickets/${ticketId}/replies/${r.body.id}`, { body: 'Corrected wording' }).expect(200);
    expect(edited.body.editedAt).toBeTruthy();
    await db.reply.update({ where: { id: r.body.id }, data: { createdAt: new Date(Date.now() - 20 * 60 * 1000) } });
    const late = await patch('employee', `/tickets/${ticketId}/replies/${r.body.id}`, { body: 'Too late' }).expect(409);
    expect(late.body.error).toContain('fifteen minutes');
  });
  it('attachments: allow-listed types only, magic bytes checked, served as downloads, removable by uploader or admin', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
    const up = await agents.employee.post(`/api/tickets/${ticketId}/attachments`).set('Origin', origin).set('X-CSRF-Token', csrf.employee).attach('file', png, { filename: 'screen shot.png', contentType: 'image/png' }).expect(201);
    expect(up.body.filename).toBe('screen shot.png');
    expect(up.body.size).toBe(png.length);
    expect(up.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    const fake = await agents.employee.post(`/api/tickets/${ticketId}/attachments`).set('Origin', origin).set('X-CSRF-Token', csrf.employee).attach('file', Buffer.from('<html>'), { filename: 'not-really.png', contentType: 'image/png' }).expect(400);
    expect(fake.body.error).toContain('do not match');
    const exe = await agents.employee.post(`/api/tickets/${ticketId}/attachments`).set('Origin', origin).set('X-CSRF-Token', csrf.employee).attach('file', Buffer.from('MZ'), { filename: 'tool.exe', contentType: 'application/octet-stream' }).expect(400);
    expect(exe.body.error).toContain('not allowed');
    const html = await agents.employee.post(`/api/tickets/${ticketId}/attachments`).set('Origin', origin).set('X-CSRF-Token', csrf.employee).attach('file', Buffer.from('<script>'), { filename: 'page.html', contentType: 'text/html' }).expect(400);
    expect(html.body.error).toContain('not allowed');
    const dl = await agents.engineer.get(`/api/tickets/${ticketId}/attachments/${up.body.id}`).expect(200);
    expect(dl.headers['content-disposition']).toContain('attachment');
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.headers['content-security-policy']).toContain('sandbox');
    expect(dl.headers['content-type']).toBe('image/png');
    await agents.other.get(`/api/tickets/${ticketId}/attachments/${up.body.id}`).expect(404);
    await del('engineer', `/tickets/${ticketId}/attachments/${up.body.id}`).expect(403);
    await del('employee', `/tickets/${ticketId}/attachments/${up.body.id}`).expect(204);
    const activity = await agents.employee.get(`/api/tickets/${ticketId}/activity`).expect(200);
    expect(activity.body.some((a: { title: string }) => a.title.includes('screen shot.png'))).toBe(true);
  });
  it('the activity stream hides internal entries from employees', async () => {
    await post('engineer', `/tickets/${ticketId}/notes`, { body: 'Internal investigation detail' }).expect(201);
    const mine = await agents.employee.get(`/api/tickets/${ticketId}/activity`).expect(200);
    expect(JSON.stringify(mine.body)).not.toContain('Internal investigation detail');
    const staff = await agents.engineer.get(`/api/tickets/${ticketId}/activity`).expect(200);
    expect(staff.body.some((a: { kind: string; body?: string }) => a.kind === 'note' && a.body === 'Internal investigation detail')).toBe(true);
  });
  it('satisfaction: only the requester, only once resolved, only once', async () => {
    await post('employee', `/tickets/${ticketId}/survey`, { score: 5 }).expect(409);
    const t = await db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    await patch('engineer', `/tickets/${ticketId}`, { version: t.version, status: 'RESOLVED' }).expect(200);
    const inbox = await agents.employee.get('/api/notifications').expect(200);
    expect(inbox.body.items.some((n: { kind: string; ticketId: string }) => n.kind === 'SURVEY_REQUEST' && n.ticketId === ticketId)).toBe(true);
    await post('engineer', `/tickets/${ticketId}/survey`, { score: 5 }).expect(403);
    await post('employee', `/tickets/${ticketId}/survey`, { score: 7 }).expect(400);
    await post('employee', `/tickets/${ticketId}/survey`, { score: 4, comment: 'Quick and clear' }).expect(201);
    await post('employee', `/tickets/${ticketId}/survey`, { score: 1 }).expect(409);
    const detail = await agents.employee.get(`/api/tickets/${ticketId}`).expect(200);
    expect(detail.body.survey.score).toBe(4);
  });
});

describe('search and the notification centre', () => {
  it('search is scoped by role and covers tickets, people, articles and assets', async () => {
    const t = await create('employee', { title: `Zebra printer ${tag}` });
    const mine = await agents.employee.get(`/api/search?q=Zebra`).expect(200);
    expect(mine.body.tickets.some((x: { id: string }) => x.id === t.id)).toBe(true);
    const others = await agents.other.get(`/api/search?q=Zebra`).expect(200);
    expect(others.body.tickets.some((x: { id: string }) => x.id === t.id)).toBe(false);
    const people = await agents.employee.get(`/api/search?q=Ws Eng`).expect(200);
    expect(people.body.people.some((p: { id: string }) => p.id === userId.engineer)).toBe(true);
    expect(JSON.stringify(people.body)).not.toContain('passwordHash');
    const short = await agents.employee.get('/api/search?q=z').expect(200);
    expect(short.body).toEqual({ tickets: [], assets: [], articles: [], people: [], departments: [], services: [] });
    // Departments and catalog services are searchable too, with enough context to identify them.
    const org = await agents.employee.get('/api/search?q=Zebra').expect(200);
    expect(Array.isArray(org.body.departments)).toBe(true);
    expect(Array.isArray(org.body.services)).toBe(true);
  });
  it('unread counts, marking read, and preferences that silence a kind', async () => {
    const before = await agents.engineer.get('/api/notifications/unread').expect(200);
    expect(before.body.unread).toBeGreaterThan(0);
    const all = await post('engineer', '/notifications/read', {}).expect(200);
    expect(all.body.marked).toBe(before.body.unread);
    expect((await agents.engineer.get('/api/notifications/unread').expect(200)).body.unread).toBe(0);
    const prefs = await agents.engineer.get('/api/notifications/preferences').expect(200);
    expect(prefs.body).toMatchObject({ mention: true, watched: true });
    await agents.engineer.put('/api/notifications/preferences').set('Origin', origin).set('X-CSRF-Token', csrf.engineer).send({ ...prefs.body, mention: false }).expect(200);
    const t = await create('employee');
    await post('employee', `/tickets/${t.id}/replies`, { body: 'Ping @Ws Engineer' }).expect(201);
    expect((await agents.engineer.get('/api/notifications/unread').expect(200)).body.unread).toBe(0);
    await agents.engineer.put('/api/notifications/preferences').set('Origin', origin).set('X-CSRF-Token', csrf.engineer).send({ ...prefs.body, mention: true }).expect(200);
  });
});
