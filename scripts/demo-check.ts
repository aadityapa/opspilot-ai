/**
 * Is this workspace ready to be demonstrated?
 *
 *   npm run demo:check
 *
 * Read-only, by construction: it counts and reads, and writes nothing. Run it five minutes before
 * a demonstration — it answers, in one screen, whether the application is up, whether the story the
 * script depends on is present, and what the ticket keys are today, so nobody has to go looking for
 * them while an audience watches.
 *
 * It never prints a password, a token or a database URL.
 */
import { db } from '../server/db.js';
import { config } from '../server/config.js';

const API = (process.env.DEMO_CHECK_API ?? `http://127.0.0.1:${config.PORT}`).replace(/\/$/, '');
const key = (n: number) => `OPS-${String(n).padStart(4, '0')}`;

type Row = { ok: boolean; label: string; detail: string };
const rows: Row[] = [];
const check = (ok: boolean, label: string, detail: string) => rows.push({ ok, label, detail });
const facts: string[] = [];

/* ── 1. The application ─────────────────────────────────────────────────── */
async function http(path: string): Promise<{ status: number; body: string } | null> {
  try {
    const res = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(4000) });
    return { status: res.status, body: (await res.text()).slice(0, 200) };
  } catch {
    return null;
  }
}

const live = await http('/api/health/live');
check(live?.status === 200, 'API is answering', live ? `GET /api/health/live → ${live.status}` : `nothing answered at ${API} — start OpsPilot first (start.bat)`);
const ready = await http('/api/health/ready');
check(ready?.status === 200, 'API reports ready', ready ? `${ready.body}` : 'no answer');

/* ── 2. The database and the story ──────────────────────────────────────── */
let dbUp = true;
try {
  await db.$queryRaw`SELECT 1`;
} catch {
  dbUp = false;
}
check(dbUp, 'Database is reachable', dbUp ? `${new URL(config.DATABASE_URL).host}` : 'no connection — see docs/OPERATIONS-RUNBOOK.md');

if (dbUp) {
  const accounts = [
    ['employee@opspilot.example', 'EMPLOYEE', 'employee — Maya Chen'],
    ['employee2@opspilot.example', 'EMPLOYEE', 'second employee — Noah Williams'],
    ['engineer@opspilot.example', 'ENGINEER', 'engineer — Alex Morgan'],
    ['admin@opspilot.example', 'ADMIN', 'administrator and manager — Jordan Patel'],
  ] as const;
  const missing: string[] = [];
  for (const [email, role, who] of accounts) {
    const u = await db.user.findUnique({ where: { email }, select: { role: true, active: true, isDemo: true, mustChangePassword: true } });
    if (!u || !u.active || u.role !== role || u.mustChangePassword) missing.push(who);
  }
  check(missing.length === 0, 'Four demo personas can sign in', missing.length ? `not usable: ${missing.join('; ')} — run npm run demo:reset` : 'employee, second employee, engineer, administrator');

  const nonDemo = await db.user.count({ where: { isDemo: false } });
  check(nonDemo === 0, 'This is a demo workspace, not a real one', nonDemo === 0 ? 'every account is a demo account' : `${nonDemo} real account(s) present — demo:reset will refuse, and should`);

  const vpn = await db.ticket.findFirst({
    where: { title: 'VPN disconnects during video calls' },
    select: { number: true, status: true, assignee: { select: { name: true } }, requester: { select: { name: true } }, asset: { select: { tag: true } }, _count: { select: { replies: true } } },
  });
  check(
    !!vpn && vpn.status === 'IN_PROGRESS' && !!vpn.assignee && !!vpn.asset && vpn._count.replies > 0,
    'Opening story ticket is in place',
    vpn ? `${key(vpn.number)} · ${vpn.status} · ${vpn.requester?.name} → ${vpn.assignee?.name ?? 'unassigned'} · asset ${vpn.asset?.tag ?? 'none'} · ${vpn._count.replies} reply(ies)` : 'missing — run npm run demo:reset',
  );
  if (vpn) facts.push(`Employee's open incident      ${key(vpn.number)}  VPN disconnects during video calls`);

  const pending = await db.approval.findMany({
    where: { status: 'PENDING' },
    select: { approver: { select: { name: true, email: true } }, ticket: { select: { number: true, title: true } } },
  });
  check(pending.length > 0, 'An approval is genuinely waiting', pending.length ? pending.map((a) => `${key(a.ticket.number)} "${a.ticket.title}" → ${a.approver.name}`).join('; ') : 'none pending — the manager step has nothing to show; run npm run demo:reset');
  for (const a of pending) facts.push(`Waiting for the manager       ${key(a.ticket.number)}  ${a.ticket.title}`);

  const article = await db.article.findFirst({ where: { title: 'Reconnect to the company VPN' }, select: { id: true, status: true, _count: { select: { chunks: true } } } });
  check(!!article && article.status === 'PUBLISHED', 'Knowledge article for the story', article ? `published, ${article._count.chunks} indexed passage(s)` : 'missing — run npm run demo:reset');
  const published = await db.article.count({ where: { status: 'PUBLISHED' } });
  const indexed = await db.article.count({ where: { status: 'PUBLISHED', chunks: { some: {} } } });
  check(indexed === published && published > 0, 'Knowledge search index is built', `${indexed} of ${published} published article(s) indexed${indexed < published ? ' — run npm run ai:reindex' : ''}`);

  const laptop = await db.asset.findFirst({ where: { tag: 'LAP-0001' }, select: { tag: true, model: true, owner: { select: { name: true, department: { select: { name: true } } } } } });
  check(!!laptop?.owner, 'Asset context for the story', laptop ? `${laptop.tag} ${laptop.model} → ${laptop.owner?.name ?? 'nobody'} (${laptop.owner?.department?.name ?? 'no department'})` : 'LAP-0001 missing — run npm run demo:reset');
  if (laptop) facts.push(`Asset in the story            ${laptop.tag}  ${laptop.model}`);

  const orphanPeople = await db.user.count({ where: { isDemo: true, departmentId: null } });
  // Printers, access points and switches are shared infrastructure and belong to nobody; a laptop
  // or a desktop in use with no owner would be a gap in the story.
  const orphanAssets = await db.asset.count({ where: { ownerId: null, status: 'IN_USE', type: { in: ['LAPTOP', 'DESKTOP'] } } });
  check(orphanPeople === 0 && orphanAssets === 0, 'Organisation hangs together', `${orphanPeople} person(s) without a department, ${orphanAssets} personal device(s) in use with no owner`);

  const [tickets, active, ratings, departments] = await Promise.all([
    db.ticket.count(),
    db.ticket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER'] } } }),
    db.survey.count(),
    db.department.count(),
  ]);
  check(active > 0 && ratings > 0, 'Dashboards have something to show', `${tickets} tickets (${active} active), ${ratings} rating(s), ${departments} departments`);

  const recent = await db.ticket.count({ where: { resolvedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } });
  check(recent > 0, 'Command Center default window is not empty', `${recent} ticket(s) resolved in the last 7 days — resolution time and satisfaction have a figure`);

  facts.push(`Personas                      employee@ · employee2@ · engineer@ · admin@opspilot.example (all @opspilot.example)`);
  facts.push(`Password                      the DEMO_PASSWORD line of .env — never printed here`);
}

/* ── 3. Report ─────────────────────────────────────────────────────────── */
const failed = rows.filter((r) => !r.ok);
console.log('\n  OpsPilot demo readiness\n');
for (const r of rows) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.label.padEnd(42)} ${r.detail}`);
if (facts.length) {
  console.log('\n  For the cheat sheet\n');
  for (const f of facts) console.log(`  ${f}`);
}
console.log(
  failed.length
    ? `\n  ${failed.length} check(s) failed. Nothing was changed — this command only reads.\n`
    : '\n  Ready to demonstrate. Nothing was changed — this command only reads.\n',
);
await db.$disconnect();
process.exit(failed.length ? 1 : 0);
