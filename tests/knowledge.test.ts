import 'dotenv/config';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { db } from '../server/db.js';
import { createApp } from '../server/app.js';
import { renderMarkdown } from '../server/knowledge.js';
import { hashPassword } from '../server/password.js';
import { config } from '../server/config.js';

if (config.NODE_ENV !== 'test' || !new URL(config.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Dedicated test database required');

const app = createApp();
const origin = config.APP_ORIGIN;
const tag = randomUUID();
const password = 'Synthetic-knowledge-2026';
const agents = [request.agent(app), request.agent(app), request.agent(app)]; // employee, engineer, admin
const ids: string[] = [];
const tokens: string[] = [];
let categoryId = '';
let employeeArticleId = '';
let supportArticleId = '';
let draftArticleId = '';
const secret = `SUPPORTONLY-${tag}`;

const post = (i: number, path: string, body: object) =>
  agents[i].post('/api' + path).set('Origin', origin).set('X-CSRF-Token', tokens[i]).send(body);
const put = (i: number, path: string, body: object) =>
  agents[i].put('/api' + path).set('Origin', origin).set('X-CSRF-Token', tokens[i]).send(body);

beforeAll(async () => {
  const hash = await hashPassword(password);
  for (const [i, role] of (['EMPLOYEE', 'ENGINEER', 'ADMIN'] as const).entries()) {
    const u = await db.user.create({
      data: { email: `kb-${i}-${tag}@example.test`, name: `KB fixture ${i}`, passwordHash: hash, role },
    });
    ids.push(u.id);
    const r = await agents[i]
      .post('/api/auth/login')
      .set('Origin', origin)
      .send({ email: u.email, password })
      .expect(200);
    tokens.push(r.body.csrfToken);
  }
  categoryId = (await db.category.create({ data: { name: `KB ${tag}` } })).id;
});

afterAll(async () => {
  await db.article.deleteMany({ where: { categoryId } });
  await db.event.deleteMany({ where: { actorId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.category.deleteMany({ where: { id: categoryId } });
  await db.$disconnect();
});

const article = (over: Record<string, unknown> = {}) => ({
  title: `Employee guidance ${tag}`,
  markdown: 'Restart the device, sign in again, and confirm the connection status shows connected.',
  categoryId,
  visibility: 'EMPLOYEE',
  status: 'PUBLISHED',
  ...over,
});

describe('knowledge base authoring and visibility', () => {
  it('restricts authoring to administrators', async () => {
    await post(0, '/articles', article()).expect(403);
    await post(1, '/articles', article()).expect(403);
    employeeArticleId = (await post(2, '/articles', article()).expect(201)).body.id;
    supportArticleId = (
      await post(2, '/articles', article({
        title: `Support runbook ${tag}`,
        markdown: `${secret} is the internal escalation procedure that employees must never read.`,
        visibility: 'SUPPORT',
      })).expect(201)
    ).body.id;
    draftArticleId = (
      await post(2, '/articles', article({
        title: `Unpublished draft ${tag}`,
        markdown: 'This draft is not published and must stay invisible to everyone but administrators.',
        status: 'DRAFT',
      })).expect(201)
    ).body.id;
    await post(2, '/articles', article({ categoryId: randomUUID() })).expect(400);
  });

  it('hides support-only and unpublished articles from employees everywhere', async () => {
    await agents[0].get(`/api/articles/${employeeArticleId}`).expect(200);
    await agents[0].get(`/api/articles/${supportArticleId}`).expect(404);
    await agents[0].get(`/api/articles/${draftArticleId}`).expect(404);
    await agents[1].get(`/api/articles/${supportArticleId}`).expect(200);
    await agents[1].get(`/api/articles/${draftArticleId}`).expect(404); // drafts are administrator-only
    await agents[2].get(`/api/articles/${draftArticleId}`).expect(200);

    const listed = await agents[0].get(`/api/articles?q=${tag}`).expect(200);
    expect(listed.body.items.map((a: { id: string }) => a.id)).toEqual([employeeArticleId]);

    // Full-text search must not become a side channel for restricted article bodies.
    const searched = await agents[0].get(`/api/articles?q=${encodeURIComponent(secret)}`).expect(200);
    expect(searched.body.total).toBe(0);
    expect(JSON.stringify(searched.body)).not.toContain(secret);

    const engineerSearch = await agents[1].get(`/api/articles?q=${encodeURIComponent(secret)}`).expect(200);
    expect(engineerSearch.body.total).toBe(1);
  });

  it('applies visibility and status changes immediately, including archiving', async () => {
    const current = await agents[2].get(`/api/articles/${employeeArticleId}`).expect(200);
    await put(2, `/articles/${employeeArticleId}`, {
      version: current.body.version,
      article: article({ visibility: 'SUPPORT' }),
    }).expect(200);
    await agents[0].get(`/api/articles/${employeeArticleId}`).expect(404);

    const bumped = await agents[2].get(`/api/articles/${employeeArticleId}`).expect(200);
    await put(2, `/articles/${employeeArticleId}`, {
      version: bumped.body.version,
      article: article({ status: 'ARCHIVED' }),
    }).expect(200);
    await agents[1].get(`/api/articles/${employeeArticleId}`).expect(404);
    await agents[0].get(`/api/articles/${employeeArticleId}`).expect(404);

    // Stale edits are rejected rather than silently overwriting a concurrent change.
    await put(2, `/articles/${employeeArticleId}`, { version: 0, article: article() }).expect(409);
  });

  it('records an audit entry for every article change', async () => {
    const audit = await agents[2].get(`/api/admin/audit?q=${employeeArticleId}`).expect(200);
    const actions = audit.body.items.map((e: { action: string }) => e.action);
    expect(actions).toContain('ARTICLE_UPDATED');
    await agents[1].get('/api/admin/audit').expect(403);
    await agents[0].get('/api/admin/audit').expect(403);
  });

  it('sanitizes rendered markdown before it reaches a browser', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).toBe('');
    expect(renderMarkdown('<img src=x onerror=alert(1)>')).not.toContain('onerror');
    expect(renderMarkdown('**bold** <iframe src=//evil></iframe>')).not.toContain('iframe');
    // A javascript: destination loses its href entirely; the anchor text is kept as inert markup.
    const injected = renderMarkdown('<a href="javascript:alert(1)">click</a>');
    expect(injected).not.toContain('javascript:');
    expect(injected).not.toContain('href');
    expect(renderMarkdown('[ok](https://example.com)')).toContain('href="https://example.com"');
    expect(renderMarkdown('[ok](https://example.com)')).toContain('rel="noopener noreferrer"');
  });
});
