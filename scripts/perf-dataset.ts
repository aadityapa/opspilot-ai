/**
 * Scale dataset for performance measurement — NOT the demo seed and never run by setup or start.
 *
 *   PERF_DATABASE_URL=postgresql://…/opspilot_perf_test npx tsx scripts/perf-dataset.ts
 *   npx tsx scripts/perf-dataset.ts --tickets 10000 --people 5000 --assets 5000 --articles 1000
 *
 * Writes synthetic, clearly fictional rows in bulk (createMany) so a realistic volume exists to run
 * queries against: people across departments, hardware, tickets over the last 400 days with SLA
 * rows, replies and events, surveys, and knowledge articles. Refuses any database whose name does
 * not end in `_perf_test`, so it cannot touch demo, test or real data. Idempotent enough: run it
 * again and it adds another batch (the point is volume, not exact counts).
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { hashPassword } from '../server/password.js';

const url = process.env.PERF_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
if (!new URL(url).pathname.endsWith('_perf_test')) throw new Error('perf-dataset refuses a database whose name does not end in _perf_test');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const arg = (name: string, fallback: number) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? Number(process.argv[i + 1]) : fallback; };
const N = { tickets: arg('tickets', 10_000), people: arg('people', 5_000), assets: arg('assets', 5_000), articles: arg('articles', 1_000) };
const DAY = 86_400_000;
const now = Date.now();
const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T>(xs: T[]) => xs[rnd(xs.length)];
const batch = 1000;

console.log(`perf dataset → ${new URL(url).host}${new URL(url).pathname}:`, N);
const started = Date.now();

// Reference data.
const categoryNames = ['Access & identity', 'Hardware', 'Network', 'Software', 'Security', 'Employee services'];
const categories: string[] = [];
for (const name of categoryNames) categories.push((await db.category.upsert({ where: { name }, update: {}, create: { name } })).id);
for (const [priority, responseMinutes, resolutionMinutes] of [['LOW', 480, 4320], ['MEDIUM', 240, 1440], ['HIGH', 60, 480], ['URGENT', 15, 120]] as const)
  await db.slaPolicy.upsert({ where: { priority }, update: {}, create: { priority, responseMinutes, resolutionMinutes } });
const policies = Object.fromEntries((await db.slaPolicy.findMany()).map((p) => [p.priority, p]));

// Departments and people (one hash reused: these accounts are never signed in to).
const hash = await hashPassword(`perf-${randomUUID()}`);
const deptIds: string[] = [];
for (let i = 0; i < 40; i++) {
  const code = `PD${String(i).padStart(2, '0')}`;
  deptIds.push((await db.department.upsert({ where: { code }, update: {}, create: { name: `Perf department ${i}`, code, costCentre: `CC-${1000 + i}` } })).id);
}
const run = randomUUID().slice(0, 6);
const people: { id: string; role: 'EMPLOYEE' | 'ENGINEER' | 'ADMIN'; departmentId: string }[] = [];
for (let i = 0; i < N.people; i += batch) {
  const rows = Array.from({ length: Math.min(batch, N.people - i) }, (_, j) => {
    const n = i + j;
    const role = n % 50 === 0 ? 'ENGINEER' as const : n % 500 === 0 ? 'ADMIN' as const : 'EMPLOYEE' as const;
    return { id: randomUUID(), email: `perf-${run}-${n}@example.test`, name: `Perf Person ${n}`, passwordHash: hash, role, departmentId: pick(deptIds), title: pick(['Analyst', 'Engineer', 'Manager', 'Associate', 'Lead']) };
  });
  await db.user.createMany({ data: rows });
  people.push(...rows.map((r) => ({ id: r.id, role: r.role, departmentId: r.departmentId })));
}
const engineers = people.filter((p) => p.role !== 'EMPLOYEE');
const employees = people.filter((p) => p.role === 'EMPLOYEE');
console.log(`people ${people.length} (${engineers.length} support)`);

// Assets.
const assetIds: string[] = [];
for (let i = 0; i < N.assets; i += batch) {
  const rows = Array.from({ length: Math.min(batch, N.assets - i) }, (_, j) => {
    const n = i + j;
    const owner = n % 3 === 0 ? null : pick(employees).id;
    return { id: randomUUID(), tag: `PF-${run}-${String(n).padStart(5, '0')}`, type: pick(['LAPTOP', 'DESKTOP', 'ACCESS_POINT', 'PRINTER', 'SWITCH'] as const), manufacturer: 'Fictional Systems', model: `Model ${n % 40}`, serialNumber: `PFSN${run}${n}`, ownerId: owner, status: owner ? 'IN_USE' as const : pick(['AVAILABLE', 'REPAIR', 'RETIRED'] as const), warrantyExpiry: new Date(now + (rnd(1200) - 300) * DAY) };
  });
  await db.asset.createMany({ data: rows });
  assetIds.push(...rows.map((r) => r.id));
}
console.log(`assets ${assetIds.length}`);

// Tickets, SLA rows, replies, events, surveys.
let created = 0;
for (let i = 0; i < N.tickets; i += batch) {
  const size = Math.min(batch, N.tickets - i);
  const tickets = Array.from({ length: size }, (_, j) => {
    const n = i + j;
    const createdAt = new Date(now - rnd(400 * DAY));
    const priority = pick(['LOW', 'LOW', 'MEDIUM', 'MEDIUM', 'MEDIUM', 'HIGH', 'URGENT'] as const);
    const policy = policies[priority];
    const status = createdAt.getTime() < now - 14 * DAY ? pick(['RESOLVED', 'RESOLVED', 'RESOLVED', 'CLOSED'] as const) : pick(['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED'] as const);
    const resolvedAt = status === 'RESOLVED' || status === 'CLOSED' ? new Date(createdAt.getTime() + rnd(policy.resolutionMinutes * 1.5) * 60000) : null;
    const requester = pick(employees);
    const assignee = status === 'OPEN' && n % 4 === 0 ? null : pick(engineers).id;
    return { id: randomUUID(), title: `Perf ticket ${run} ${n}: ${pick(['VPN drops', 'Laptop battery', 'Printer offline', 'Access to folder', 'Software licence', 'Wi-Fi in room', 'Email delay', 'Password reset'])}`, description: 'Synthetic ticket written by the performance dataset script. Fictional, for load measurement only.', status, priority, categoryId: pick(categories), requesterId: requester.id, assigneeId: assignee, createdAt, updatedAt: resolvedAt ?? createdAt, resolvedAt, closedAt: status === 'CLOSED' ? resolvedAt : null, type: pick(['INCIDENT', 'INCIDENT', 'INCIDENT', 'REQUEST', 'PROBLEM'] as const), assetId: n % 5 === 0 ? pick(assetIds) : null, labels: n % 7 === 0 ? ['perf'] : [], firstRespondedAt: n % 3 === 0 ? new Date(createdAt.getTime() + rnd(policy.responseMinutes * 2) * 60000) : null, _policy: policy };
  });
  await db.ticket.createMany({ data: tickets.map(({ _policy, ...t }) => t) });
  await db.ticketSla.createMany({ data: tickets.map((t) => {
    const responseSatisfiedAt = t.firstRespondedAt;
    const responseBreachAt = responseSatisfiedAt && responseSatisfiedAt.getTime() > t.createdAt.getTime() + t._policy.responseMinutes * 60000 ? new Date(t.createdAt.getTime() + t._policy.responseMinutes * 60000) : null;
    const finished = !!t.resolvedAt;
    const elapsedMs = finished ? t.resolvedAt!.getTime() - t.createdAt.getTime() : 0;
    return { ticketId: t.id, priority: t.priority, responseMinutes: t._policy.responseMinutes, resolutionMinutes: t._policy.resolutionMinutes, startedAt: t.createdAt, responseDueAt: new Date(t.createdAt.getTime() + t._policy.responseMinutes * 60000), responseSatisfiedAt, responseBreachAt, resolutionBreachAt: finished && elapsedMs > t._policy.resolutionMinutes * 60000 ? new Date(t.createdAt.getTime() + t._policy.resolutionMinutes * 60000) : null, elapsedMs, runningSince: finished || t.status === 'WAITING_FOR_USER' ? null : t.createdAt };
  }) });
  await db.event.createMany({ data: tickets.flatMap((t) => [
    { ticketId: t.id, actorId: t.requesterId, action: 'CREATED', detail: 'Ticket created', internal: false, createdAt: t.createdAt },
    ...(t.assigneeId ? [{ ticketId: t.id, actorId: t.assigneeId, action: 'UPDATED', detail: 'assigneeId: null → set', internal: true, createdAt: new Date(t.createdAt.getTime() + 60000) }] : []),
    ...(t.resolvedAt ? [{ ticketId: t.id, actorId: t.assigneeId ?? t.requesterId, action: 'UPDATED', detail: 'status: IN_PROGRESS → RESOLVED', internal: true, createdAt: t.resolvedAt }] : []),
  ]) });
  await db.reply.createMany({ data: tickets.filter((t) => t.firstRespondedAt).map((t) => ({ ticketId: t.id, authorId: t.assigneeId ?? pick(engineers).id, body: 'Thanks — looking into this now.', createdAt: t.firstRespondedAt! })) });
  await db.survey.createMany({ data: tickets.filter((t, k) => t.resolvedAt && k % 4 === 0).map((t) => ({ ticketId: t.id, respondentId: t.requesterId, score: 1 + rnd(5), createdAt: new Date(t.resolvedAt!.getTime() + 3600000) })) });
  created += size;
  if (created % 2000 === 0) console.log(`tickets ${created}`);
}
console.log(`tickets ${created}`);

// Knowledge.
const adminId = engineers.find((e) => e.role === 'ADMIN')?.id ?? engineers[0].id;
for (let i = 0; i < N.articles; i += batch) {
  await db.article.createMany({ data: Array.from({ length: Math.min(batch, N.articles - i) }, (_, j) => ({ title: `Perf article ${run} ${i + j}: ${pick(['VPN', 'Printer', 'Battery', 'Access', 'Email'])} guidance`, markdown: `# Guidance\n\nSynthetic knowledge article ${i + j} from the performance dataset. It exists so search and listing have volume.\n\n## Steps\n\n1. First step.\n2. Second step.`, status: 'PUBLISHED' as const, visibility: (i + j) % 5 === 0 ? 'SUPPORT' as const : 'EMPLOYEE' as const, categoryId: pick(categories), authorId: adminId, publishedAt: new Date(now - rnd(300 * DAY)) })) });
}
console.log(`articles ${N.articles}`);
console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
await db.$disconnect();
