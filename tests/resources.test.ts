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

/**
 * The Phase 4 resource layer over the API: article feedback, the knowledge aggregates, the asset
 * summary, and the directory filters. The point of every case here is the same — an aggregate must
 * be computed under the caller's own scope, so a count can never reveal something the caller could
 * not have listed one row at a time.
 */
const app = createApp();
const origin = config.APP_ORIGIN;
const tag = randomUUID();
const password = 'Synthetic-resources-password-2026';
const agents = { employee: request.agent(app), engineer: request.agent(app), admin: request.agent(app) };
const csrf: Record<string, string> = {};
const userId: Record<string, string> = {};
const ids: string[] = [];
let categoryId = '';
let departmentId = '';
let publicArticle = '';
let supportArticle = '';
const assetIds: string[] = [];

const post = (who: keyof typeof agents, path: string, body: unknown) => agents[who].post(`/api${path}`).set('Origin', origin).set('X-CSRF-Token', csrf[who]).send(body as object);

beforeAll(async () => {
  const hash = await hashPassword(password);
  for (const [name, role] of [['employee', 'EMPLOYEE'], ['engineer', 'ENGINEER'], ['admin', 'ADMIN']] as const) {
    const u = await db.user.create({ data: { email: `res-${name}-${tag}@example.test`, name: `Res ${name}`, passwordHash: hash, role } });
    ids.push(u.id);
    userId[name] = u.id;
    csrf[name] = (await agents[name].post('/api/auth/login').set('Origin', origin).send({ email: u.email, password }).expect(200)).body.csrfToken;
  }
  categoryId = (await db.category.create({ data: { name: `Res ${tag}` } })).id;
  departmentId = (await db.department.create({ data: { name: `Res dept ${tag}`, code: `R${tag.slice(0, 6).toUpperCase()}`, costCentre: 'CC-RES' } })).id;
  await db.user.update({ where: { id: userId.employee }, data: { departmentId, managerId: userId.admin, title: `Res title ${tag.slice(0, 6)}` } });
  publicArticle = (await db.article.create({ data: { title: `Res public ${tag}`, markdown: '## Public\n\nVisible to everyone.', categoryId, authorId: userId.admin, visibility: 'EMPLOYEE', status: 'PUBLISHED', publishedAt: new Date() } })).id;
  supportArticle = (await db.article.create({ data: { title: `Res runbook ${tag}`, markdown: '## Runbook\n\nSupport only.', categoryId, authorId: userId.admin, visibility: 'SUPPORT', status: 'PUBLISHED', publishedAt: new Date() } })).id;
  for (const [i, owner] of [userId.employee, null, null].entries()) {
    const a = await db.asset.create({ data: { tag: `RES-${tag.slice(0, 4).toUpperCase()}-${i}`, type: 'LAPTOP', manufacturer: 'Res Systems', model: 'Res 14', serialNumber: `RS-${tag.slice(0, 8)}-${i}`, ownerId: owner, status: i === 2 ? 'RETIRED' : 'IN_USE' } });
    assetIds.push(a.id);
  }
});
afterAll(async () => {
  await db.articleFeedback.deleteMany({ where: { articleId: { in: [publicArticle, supportArticle] } } });
  await db.article.deleteMany({ where: { id: { in: [publicArticle, supportArticle] } } });
  await db.asset.deleteMany({ where: { id: { in: assetIds } } });
  await db.user.updateMany({ where: { id: { in: ids } }, data: { departmentId: null, managerId: null } });
  await db.category.deleteMany({ where: { id: categoryId } });
  await db.department.deleteMany({ where: { id: departmentId } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

describe('article feedback', () => {
  it('counts one verdict per person, lets them change it, and reports the caller their own vote', async () => {
    const first = await post('employee', `/articles/${publicArticle}/feedback`, { helpful: true }).expect(200);
    expect(first.body).toMatchObject({ helpful: 1, notHelpful: 0, mine: true });
    // Voting again replaces the person's own verdict rather than adding a second one.
    const changed = await post('employee', `/articles/${publicArticle}/feedback`, { helpful: false }).expect(200);
    expect(changed.body).toMatchObject({ helpful: 0, notHelpful: 1, mine: false });
    const second = await post('engineer', `/articles/${publicArticle}/feedback`, { helpful: true }).expect(200);
    expect(second.body).toMatchObject({ helpful: 1, notHelpful: 1, mine: true });
    // A different reader sees the totals but not somebody else's vote as their own.
    const read = await agents.admin.get(`/api/articles/${publicArticle}`).expect(200);
    expect(read.body.feedback).toMatchObject({ helpful: 1, notHelpful: 1, mine: null });
    expect(await db.articleFeedback.count({ where: { articleId: publicArticle } })).toBe(2);
  });
  it('refuses a verdict on an article the caller may not read, without revealing that it exists', async () => {
    await post('employee', `/articles/${supportArticle}/feedback`, { helpful: true }).expect(404);
    await post('engineer', `/articles/${supportArticle}/feedback`, { helpful: true }).expect(200);
    expect(await db.articleFeedback.count({ where: { articleId: supportArticle, userId: userId.employee } })).toBe(0);
  });
  it('rejects anything that is not a boolean verdict', async () => {
    await post('employee', `/articles/${publicArticle}/feedback`, { helpful: 'yes' }).expect(400);
    await post('employee', `/articles/${publicArticle}/feedback`, {}).expect(400);
  });
});

describe('knowledge overview', () => {
  it('counts only what the caller may read', async () => {
    const employee = await agents.employee.get('/api/knowledge/overview').expect(200);
    const engineer = await agents.engineer.get('/api/knowledge/overview').expect(200);
    const mine = employee.body.categories.find((c: { id: string }) => c.id === categoryId);
    const theirs = engineer.body.categories.find((c: { id: string }) => c.id === categoryId);
    expect(mine.articles).toBe(1);
    expect(theirs.articles).toBe(2);
    expect(engineer.body.total).toBeGreaterThan(employee.body.total);
    // The restricted runbook never appears in an employee's recent or helpful lists either.
    const employeeJson = JSON.stringify(employee.body);
    expect(employeeJson).not.toContain(supportArticle);
    expect(employeeJson).not.toContain(`Res runbook ${tag}`);
  });
  it('ranks most-helpful by real votes and omits articles nobody rated', async () => {
    await post('engineer', `/articles/${publicArticle}/feedback`, { helpful: true }).expect(200);
    const overview = await agents.engineer.get('/api/knowledge/overview').expect(200);
    const row = overview.body.helpful.find((a: { id: string }) => a.id === publicArticle);
    expect(row.helpfulVotes).toBeGreaterThanOrEqual(1);
    expect(overview.body.helpful.every((a: { helpfulVotes: number }) => a.helpfulVotes > 0)).toBe(true);
  });
});

describe('asset summary and filters', () => {
  it('totals exactly the rows the caller may list', async () => {
    const list = await agents.employee.get('/api/assets?pageSize=100').expect(200);
    const summary = await agents.employee.get('/api/assets/summary').expect(200);
    expect(summary.body.total).toBe(list.body.total);
    // The employee owns one of the three seeded assets and can see no others.
    expect(list.body.items.every((a: { ownerId: string }) => a.ownerId === userId.employee)).toBe(true);
    const adminSummary = await agents.admin.get('/api/assets/summary').expect(200);
    expect(adminSummary.body.total).toBeGreaterThan(summary.body.total);
    expect(adminSummary.body.assigned + adminSummary.body.unassigned).toBeLessThanOrEqual(adminSummary.body.total);
  });
  it('applies the same filter to the summary as to the list', async () => {
    const filtered = await agents.admin.get('/api/assets?status=RETIRED&pageSize=100').expect(200);
    const summary = await agents.admin.get('/api/assets/summary?status=RETIRED').expect(200);
    expect(summary.body.total).toBe(filtered.body.total);
    expect(summary.body.retired).toBe(filtered.body.total);
  });
  it('filters by owner, department and unassigned state', async () => {
    const owned = await agents.admin.get(`/api/assets?ownerId=${userId.employee}&pageSize=100`).expect(200);
    expect(owned.body.items.every((a: { ownerId: string }) => a.ownerId === userId.employee)).toBe(true);
    const byDepartment = await agents.admin.get(`/api/assets?departmentId=${departmentId}&pageSize=100`).expect(200);
    expect(byDepartment.body.items.some((a: { id: string }) => a.id === assetIds[0])).toBe(true);
    const unassigned = await agents.admin.get('/api/assets?ownerId=none&pageSize=100').expect(200);
    expect(unassigned.body.items.every((a: { ownerId: string | null }) => a.ownerId === null)).toBe(true);
    // The owner's department travels with the row, so the inventory can be read by business unit.
    expect(owned.body.items[0].owner.department.id).toBe(departmentId);
  });
  it('gives an employee their own asset with its service history, and nobody else theirs', async () => {
    await agents.employee.get(`/api/assets/${assetIds[0]}`).expect(200);
    await agents.employee.get(`/api/assets/${assetIds[2]}`).expect(404);
  });
});

describe('directory filters', () => {
  it('filters people by department, manager and role without widening what is returned', async () => {
    const byDepartment = await agents.employee.get(`/api/people?departmentId=${departmentId}`).expect(200);
    expect(byDepartment.body.items.every((p: { department: { id: string } | null }) => p.department?.id === departmentId)).toBe(true);
    const byManager = await agents.employee.get(`/api/people?managerId=${userId.admin}`).expect(200);
    expect(byManager.body.items.some((p: { id: string }) => p.id === userId.employee)).toBe(true);
    const byRole = await agents.employee.get('/api/people?role=ENGINEER').expect(200);
    expect(byRole.body.items.every((p: { role: string }) => p.role === 'ENGINEER')).toBe(true);
    expect(JSON.stringify(byDepartment.body)).not.toContain('passwordHash');
  });
  it('shows a person their own tickets and assets, and an employee nobody else\'s', async () => {
    const own = await agents.employee.get(`/api/people/${userId.employee}`).expect(200);
    expect(Array.isArray(own.body.assets)).toBe(true);
    expect(own.body.assets.some((a: { id: string }) => a.id === assetIds[0])).toBe(true);
    const other = await agents.employee.get(`/api/people/${userId.engineer}`).expect(200);
    expect(other.body.assets).toEqual([]);
    expect(other.body.openTickets).toEqual([]);
    // A support role may see the same profile's work, because the API says so — not the interface.
    const staffView = await agents.engineer.get(`/api/people/${userId.employee}`).expect(200);
    expect(staffView.body.assets.some((a: { id: string }) => a.id === assetIds[0])).toBe(true);
  });
});
