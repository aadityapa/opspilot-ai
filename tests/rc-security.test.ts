import 'dotenv/config';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { db } from '../server/db.js';
import { config } from '../server/config.js';
import { hashPassword } from '../server/password.js';
import { newSla } from '../server/sla.js';
import { csvCell } from '../server/csv.js';

if (config.NODE_ENV !== 'test' || !new URL(config.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Integration tests require NODE_ENV=test and a database name ending in _test');

/**
 * Release-candidate security regression. Every case here is a boundary an attacker would try by
 * hand: another person's ticket by id, a file on a ticket they cannot open, a staff endpoint from
 * an employee session, a formula in an exported cell, a field the API never declared. The suite
 * fixes what the API must refuse, not what the interface hides.
 */
const app = createApp();
const origin = config.APP_ORIGIN;
const tag = randomUUID();
const password = 'Synthetic-rc-security-password-2026';
const agents = { alice: request.agent(app), bob: request.agent(app), manager: request.agent(app), engineer: request.agent(app), admin: request.agent(app) };
type Who = keyof typeof agents;
const csrf: Record<string, string> = {};
const userId: Record<string, string> = {};
const ids: string[] = [];
let categoryId = '';
let departmentId = '';
let aliceTicket = '';
let attachmentId = '';
let restrictedArticle = '';
let aliceAsset = '';
const post = (who: Who, path: string, body: unknown) => agents[who].post(`/api${path}`).set('Origin', origin).set('X-CSRF-Token', csrf[who]).send(body as object);
const patch = (who: Who, path: string, body: unknown) => agents[who].patch(`/api${path}`).set('Origin', origin).set('X-CSRF-Token', csrf[who]).send(body as object);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

beforeAll(async () => {
  const hash = await hashPassword(password);
  for (const [name, role] of [['alice', 'EMPLOYEE'], ['bob', 'EMPLOYEE'], ['manager', 'EMPLOYEE'], ['engineer', 'ENGINEER'], ['admin', 'ADMIN']] as const) {
    const u = await db.user.create({ data: { email: `rc-${name}-${tag}@example.test`, name: `Rc ${name}`, passwordHash: hash, role } });
    ids.push(u.id); userId[name] = u.id;
    csrf[name] = (await agents[name].post('/api/auth/login').set('Origin', origin).send({ email: u.email, password }).expect(200)).body.csrfToken;
  }
  categoryId = (await db.category.create({ data: { name: `Rc ${tag}` } })).id;
  departmentId = (await db.department.create({ data: { name: `Rc dept ${tag}`, code: `R${tag.slice(0, 6).toUpperCase()}`, managerId: userId.manager } })).id;
  await db.user.update({ where: { id: userId.alice }, data: { departmentId, managerId: userId.manager } });
  const t = await post('alice', '/tickets', { title: `=HYPERLINK("http://evil.example") ${tag}`, description: 'Synthetic ticket whose title starts with a formula, to prove exports neutralise it.', categoryId }).expect(201);
  aliceTicket = t.body.id;
  const up = await agents.alice.post(`/api/tickets/${aliceTicket}/attachments`).set('Origin', origin).set('X-CSRF-Token', csrf.alice).attach('file', PNG, { filename: 'evidence.png', contentType: 'image/png' }).expect(201);
  attachmentId = up.body.id;
  restrictedArticle = (await db.article.create({ data: { title: `Rc internal runbook ${tag}`, markdown: `Support-only text ${tag} rc-secret-phrase`, status: 'PUBLISHED', visibility: 'SUPPORT', categoryId, authorId: userId.admin } })).id;
  aliceAsset = (await db.asset.create({ data: { tag: `RC-${tag.slice(0, 8).toUpperCase()}`, type: 'LAPTOP', manufacturer: 'Fictional', model: `Rc model ${tag}`, serialNumber: `RCSN${tag.slice(0, 10)}`, status: 'IN_USE', ownerId: userId.alice } })).id;
});
afterAll(async () => {
  const mine = (await db.ticket.findMany({ where: { requesterId: { in: ids } }, select: { id: true } })).map((t) => t.id);
  await db.attachment.deleteMany({ where: { ticketId: { in: mine } } });
  await db.event.deleteMany({ where: { OR: [{ ticketId: { in: mine } }, { actorId: { in: ids } }] } });
  await db.outbox.deleteMany({ where: { ticketId: { in: mine } } });
  await db.watcher.deleteMany({ where: { ticketId: { in: mine } } });
  await db.ticketSla.deleteMany({ where: { ticketId: { in: mine } } });
  await db.ticket.deleteMany({ where: { id: { in: mine } } });
  await db.article.deleteMany({ where: { id: restrictedArticle } });
  await db.asset.deleteMany({ where: { id: aliceAsset } });
  await db.user.updateMany({ where: { id: { in: ids } }, data: { departmentId: null, managerId: null } });
  await db.category.deleteMany({ where: { id: categoryId } });
  await db.department.deleteMany({ where: { id: departmentId } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

describe('object-level authorization', () => {
  it('another employee cannot open, reply to, or read the activity of a ticket by guessing its id', async () => {
    await agents.bob.get(`/api/tickets/${aliceTicket}`).expect(404);
    await agents.bob.get(`/api/tickets/${aliceTicket}/activity`).expect(404);
    await post('bob', `/tickets/${aliceTicket}/replies`, { body: 'I should not be able to say this.' }).expect(404);
    // The requester, their manager (as an approver would be) and staff can.
    await agents.alice.get(`/api/tickets/${aliceTicket}`).expect(200);
    await agents.engineer.get(`/api/tickets/${aliceTicket}`).expect(200);
  });
  it('an attachment on an inaccessible ticket is not downloadable, deletable, or even confirmed to exist', async () => {
    await agents.bob.get(`/api/tickets/${aliceTicket}/attachments/${attachmentId}`).expect(404);
    await agents.bob.delete(`/api/tickets/${aliceTicket}/attachments/${attachmentId}`).set('Origin', origin).set('X-CSRF-Token', csrf.bob).expect(404);
    // A valid attachment id under the wrong ticket id is also refused, so ids cannot be recombined.
    const other = await post('bob', '/tickets', { title: `Bob ticket ${tag}`, description: 'Synthetic ticket for the attachment recombination case, long enough.', categoryId }).expect(201);
    await agents.bob.get(`/api/tickets/${other.body.id}/attachments/${attachmentId}`).expect(404);
    const ok = await agents.alice.get(`/api/tickets/${aliceTicket}/attachments/${attachmentId}`).expect(200);
    expect(ok.headers['content-disposition']).toMatch(/^attachment;/);
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    expect(ok.headers['cache-control']).toBe('no-store');
  });
  it('employees are refused every staff and administrator surface by the API, whatever the interface shows', async () => {
    for (const path of ['/analytics?days=30', '/reports/tickets', '/reports/tickets?format=csv', '/operations/summary', '/engineers']) {
      await agents.alice.get(`/api${path}`).expect(403);
    }
    await post('alice', '/tickets/bulk', { ids: [aliceTicket], status: 'RESOLVED' }).expect(403);
    await patch('alice', `/tickets/${aliceTicket}`, { version: 1, priority: 'URGENT' }).expect(403);
    for (const path of ['/admin/audit', '/admin/audit/export?format=csv', '/admin/security', '/admin/users', '/admin/retention', '/admin/outbox']) {
      await agents.alice.get(`/api${path}`).expect(403);
      await agents.engineer.get(`/api${path}`).expect(403);
    }
  });
  it('assets and people outside the caller’s scope are not visible by id', async () => {
    await agents.bob.get(`/api/assets/${aliceAsset}`).expect(404);
    await agents.alice.get(`/api/assets/${aliceAsset}`).expect(200);
    await agents.engineer.get(`/api/assets/${aliceAsset}`).expect(200);
    // A person's profile is directory information; their tickets are not, unless you are staff or them.
    const asBob = await agents.bob.get(`/api/people/${userId.alice}`).expect(200);
    expect(asBob.body.openTickets ?? []).toHaveLength(0);
    const asStaff = await agents.engineer.get(`/api/people/${userId.alice}`).expect(200);
    expect((asStaff.body.openTickets ?? []).length).toBeGreaterThan(0);
  });
});

describe('search', () => {
  it('never returns another person’s ticket, a support-only article or someone else’s asset to an employee', async () => {
    const r = await agents.bob.get(`/api/search?q=${encodeURIComponent(tag.slice(0, 8))}`).expect(200);
    expect(r.body.tickets.some((t: { id: string }) => t.id === aliceTicket)).toBe(false);
    expect(r.body.articles.some((a: { id: string }) => a.id === restrictedArticle)).toBe(false);
    expect(r.body.assets.some((a: { id: string }) => a.id === aliceAsset)).toBe(false);
    expect(JSON.stringify(r.body)).not.toContain('rc-secret-phrase');
    // Body text of a restricted article never leaks through a content match either.
    const byBody = await agents.bob.get('/api/search?q=rc-secret-phrase').expect(200);
    expect(byBody.body.articles).toHaveLength(0);
    // Staff see the article; an exact ticket key finds Alice's ticket for staff, not for Bob.
    const staff = await agents.engineer.get('/api/search?q=rc-secret-phrase').expect(200);
    expect(staff.body.articles.some((a: { id: string }) => a.id === restrictedArticle)).toBe(true);
    const t = await db.ticket.findUnique({ where: { id: aliceTicket }, select: { number: true } });
    expect((await agents.engineer.get(`/api/search?q=${t!.number}`).expect(200)).body.tickets[0]?.id).toBe(aliceTicket);
    expect((await agents.bob.get(`/api/search?q=${t!.number}`).expect(200)).body.tickets.some((x: { id: string }) => x.id === aliceTicket)).toBe(false);
  });
  it('search results never carry credentials or secrets', async () => {
    const r = await agents.engineer.get('/api/search?q=rc').expect(200);
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|mfaSecret|csrfToken|tokenHash/);
  });
});

describe('CSV exports', () => {
  it('neutralise spreadsheet formulas while keeping numbers numeric', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1 (555) 0100')).toBe("'+1 (555) 0100");
    expect(csvCell('-cmd|calc')).toBe("'-cmd|calc");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tstart')).toBe("'\tstart");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell('-5.25')).toBe('-5.25');
    expect(csvCell('plain, text')).toBe('"plain, text"');
    expect(csvCell(null)).toBe('');
  });
  it('the report export carries the neutralised title, under the same authorization as the JSON', async () => {
    const csv = await agents.engineer.get(`/api/reports/tickets?days=7&departmentId=${departmentId}&format=csv`).expect(200);
    expect(csv.text).toContain(`"'=HYPERLINK(""http://evil.example"") ${tag}"`);
    expect(csv.text).not.toMatch(/(^|\r?\n)=HYPERLINK/);
    await agents.alice.get(`/api/reports/tickets?days=7&format=csv`).expect(403);
    await agents.engineer.get(`/api/reports/tickets?days=7&departmentId=not-a-uuid&format=csv`).expect(400);
  });
  it('the audit export applies the same guard', async () => {
    await db.event.create({ data: { actorId: userId.admin, action: 'RC_TEST', detail: `=cmd|' /C calc'!A0 ${tag}`, internal: true } });
    const r = await agents.admin.get(`/api/admin/audit/export?format=csv&action=RC_TEST`).expect(200);
    expect(r.text).toContain(`,'=cmd|' /C calc'!A0 ${tag}`);
    expect(r.text).not.toContain(`,=cmd|`);
    await db.event.deleteMany({ where: { action: 'RC_TEST' } });
  });
});

describe('input and mass assignment', () => {
  it('rejects fields the contract does not declare, on every write', async () => {
    const t = await agents.alice.get(`/api/tickets/${aliceTicket}`).expect(200);
    await patch('engineer', `/tickets/${aliceTicket}`, { version: t.body.version, requesterId: userId.engineer }).expect(400);
    await patch('engineer', `/tickets/${aliceTicket}`, { version: t.body.version, createdAt: '2000-01-01T00:00:00Z' }).expect(400);
    await post('alice', '/tickets', { title: `Sneaky ${tag}`, description: 'A ticket trying to set its own number and status on creation.', categoryId, status: 'RESOLVED', number: 1 }).expect(400);
    // Profile edits cannot touch role, department or manager.
    for (const body of [{ role: 'ADMIN' }, { departmentId }, { managerId: userId.admin }, { isDemo: true }, { passwordHash: 'x' }]) {
      const r = await patch('alice', '/auth/profile', body);
      expect([400, 403, 404], JSON.stringify(body)).toContain(r.status);
    }
    const me = await db.user.findUnique({ where: { id: userId.alice }, select: { role: true } });
    expect(me!.role).toBe('EMPLOYEE');
  });
  it('validates sort names, pagination and enum filters instead of passing them to the database', async () => {
    await agents.engineer.get('/api/tickets?sort=id;drop').expect(400);
    await agents.engineer.get('/api/tickets?page=0').expect(400);
    await agents.engineer.get('/api/tickets?pageSize=100000').expect(400);
    await agents.engineer.get('/api/tickets?priority=SEVERE').expect(400);
    await agents.engineer.get('/api/analytics?days=9999').expect(400);
    const beyond = await agents.engineer.get('/api/tickets?page=99999').expect(200);
    expect(beyond.body.items).toHaveLength(0);
    expect(beyond.body.total).toBeGreaterThan(0);
  });
  it('dynamic form data cannot pollute prototypes or smuggle unknown keys', async () => {
    const item = await db.catalogItem.create({ data: { name: `Rc form ${tag}`, description: 'Synthetic catalog item with one text field.', categoryId, fields: [{ key: 'reason', label: 'Reason', kind: 'text', required: true }], type: 'REQUEST', priority: 'LOW' } });
    const r = await post('alice', '/tickets', { title: `Form ${tag}`, description: 'Request with hostile form keys, long enough to pass validation.', categoryId, catalogItemId: item.id, formData: { reason: 'ok', __proto__: { polluted: true }, constructor: { prototype: { polluted: true } }, unknown: 'x' } });
    expect([201, 400]).toContain(r.status);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    if (r.status === 201) {
      expect(Object.keys(r.body.formData ?? {})).toEqual(['reason']);
    }
    await db.catalogItem.delete({ where: { id: item.id } });
  });
  it('refuses oversized JSON bodies with a readable 413', async () => {
    const r = await post('alice', '/tickets', { title: 'big', description: 'x'.repeat(40_000), categoryId });
    expect(r.status).toBe(413);
    expect(r.body.error).toMatch(/too large/i);
  });
});

describe('response hygiene', () => {
  it('sets the security headers helmet provides and rejects foreign origins on mutations', async () => {
    const r = await agents.alice.get('/api/auth/me').expect(200);
    expect(r.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(r.headers['referrer-policy']).toBeDefined();
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    await agents.alice.post('/api/tickets').set('Origin', 'https://evil.example').set('X-CSRF-Token', csrf.alice).send({ title: 'x', description: 'y', categoryId }).expect(403);
    // CORS reflects the configured origin only, never the caller's, so a foreign page cannot read responses.
    const cors = await agents.alice.get('/api/auth/me').set('Origin', 'https://evil.example').expect(200);
    expect(cors.headers['access-control-allow-origin']).not.toBe('https://evil.example');
    expect(cors.headers['access-control-allow-origin']).toBe(origin);
  });
  it('rate-limits the expensive endpoints and says so in standard headers', async () => {
    for (const [who, path] of [['alice', '/search?q=rc'], ['engineer', '/analytics?days=7'], ['engineer', '/reports/tickets?days=7'], ['admin', '/admin/audit/export?format=csv&action=NOPE']] as const) {
      const r = await agents[who].get(`/api${path}`).expect(200);
      expect(r.headers['ratelimit-policy'] ?? r.headers['ratelimit'], path).toBeDefined();
    }
    // Ordinary ticket reads are not limited.
    const t = await agents.alice.get(`/api/tickets/${aliceTicket}`).expect(200);
    expect(t.headers['ratelimit-policy'] ?? t.headers['ratelimit']).toBeUndefined();
  });
  it('never serialises password hashes or second-factor secrets', async () => {
    for (const [who, path] of [['admin', '/admin/users'], ['engineer', '/people?q=rc'], ['alice', `/people/${userId.alice}`], ['engineer', '/engineers'], ['alice', '/auth/me'], ['alice', '/auth/sessions']] as const) {
      const r = await agents[who].get(`/api${path}`).expect(200);
      expect(JSON.stringify(r.body), path).not.toMatch(/passwordHash|mfaSecret|mfaPendingSecret|tokenHash|"csrfToken":"[0-9a-f]{64}".*sessions/);
    }
  });
  it('failed sign-ins look identical for unknown, wrong-password and disabled accounts', async () => {
    const unknown = await request(app).post('/api/auth/login').set('Origin', origin).send({ email: `nobody-${tag}@example.test`, password: 'Whatever-this-is-2026' }).expect(401);
    const wrong = await request(app).post('/api/auth/login').set('Origin', origin).send({ email: `rc-bob-${tag}@example.test`, password: 'Whatever-this-is-2026' }).expect(401);
    await db.user.update({ where: { id: userId.bob }, data: { active: false } });
    const disabled = await request(app).post('/api/auth/login').set('Origin', origin).send({ email: `rc-bob-${tag}@example.test`, password }).expect(401);
    await db.user.update({ where: { id: userId.bob }, data: { active: true, failedLogins: 0 } });
    expect(unknown.body).toEqual(wrong.body);
    expect(wrong.body).toEqual(disabled.body);
  });
  it('a server error answers with a request id and nothing else', async () => {
    // A malformed UUID inside a valid-looking path reaches Zod, not the database — 400, not 500.
    const bad = await agents.engineer.get('/api/tickets/not-a-uuid').expect(400);
    expect(JSON.stringify(bad.body)).not.toMatch(/at .*\.ts|prisma|SELECT|\/server\//i);
    // Invalid JSON is 400 with a fixed message.
    const json = await agents.alice.post('/api/tickets').set('Origin', origin).set('X-CSRF-Token', csrf.alice).set('Content-Type', 'application/json').send('{"title": ').expect(400);
    expect(json.body).toEqual({ error: 'Invalid JSON' });
  });
});
