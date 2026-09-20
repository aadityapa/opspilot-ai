/**
 * Governance: audit export, personal-data export and erasure, and retention.
 *
 * Erasure follows the usual enterprise compromise between a person's right to be forgotten and
 * the organisation's need to keep operational records: the account is anonymised and disabled,
 * every credential and session is destroyed, and personal identifiers are removed — but ticket
 * history stays, attributed to "Deleted user". What is kept and what is removed is listed in
 * docs/GOVERNANCE.md and returned by the endpoint itself, so nobody has to guess.
 */
import { csvCell } from './csv.js';
import { heavyReadLimit } from './limits.js';
import { Router, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db } from './db.js';
import { config } from './config.js';
import { admin, fail, idOf } from './http.js';
import { audit, clientIp } from './auth.js';
import { hashPassword } from './password.js';
import { systemClock, type Clock } from './sla.js';
import { log } from './observability.js';

/* ── Audit export ───────────────────────────────────────────────────────── */


const exportSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  action: z.string().max(60).optional(),
  format: z.enum(['csv', 'json']).default('csv'),
});

export const governanceRouter = Router();

/** Streams the audit log in pages so an export never holds the whole table in memory. */
governanceRouter.get('/admin/audit/export', admin, heavyReadLimit, async (req, res) => {
  const f = exportSchema.parse(req.query);
  const where = {
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    ...(f.action ? { action: { contains: f.action, mode: 'insensitive' as const } } : {}),
  };
  await audit(db, { actorId: res.locals.user.id, action: 'AUDIT_EXPORTED', detail: `Audit log exported as ${f.format}${f.from ? ` from ${f.from.toISOString()}` : ''}${f.to ? ` to ${f.to.toISOString()}` : ''}${f.action ? ` filtered by "${f.action}"` : ''}`, ip: clientIp(req) });
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="opspilot-audit-${stamp}.${f.format}"`);
  res.type(f.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json');
  const columns = ['id', 'createdAt', 'action', 'actorId', 'actorName', 'actorEmail', 'ticketId', 'ip', 'internal', 'detail'] as const;
  if (f.format === 'csv') res.write(`${columns.join(',')}\n`);
  else res.write('[');
  let cursor: string | undefined;
  let first = true;
  for (;;) {
    const rows = await db.event.findMany({ where, include: { actor: { select: { name: true, email: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 500, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
    for (const row of rows) {
      const record = { id: row.id, createdAt: row.createdAt, action: row.action, actorId: row.actorId, actorName: row.actor?.name ?? null, actorEmail: row.actor?.email ?? null, ticketId: row.ticketId, ip: row.ip, internal: row.internal, detail: row.detail };
      if (f.format === 'csv') res.write(`${columns.map((c) => csvCell(record[c])).join(',')}\n`);
      else {
        res.write(`${first ? '' : ','}${JSON.stringify(record)}`);
        first = false;
      }
    }
    if (rows.length < 500) break;
    cursor = rows[rows.length - 1].id;
  }
  if (f.format === 'json') res.write(']');
  res.end();
});

/* ── Personal data export ───────────────────────────────────────────────── */

export async function exportUserData(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true, role: true, active: true, createdAt: true, lastLoginAt: true, passwordChangedAt: true, mfaEnabled: true, deletedAt: true } });
  if (!user) return null;
  const [tickets, replies, events, assets, notifications, aiUsage, sessions] = await Promise.all([
    db.ticket.findMany({ where: { OR: [{ requesterId: userId }, { assigneeId: userId }] }, select: { id: true, number: true, title: true, description: true, status: true, priority: true, createdAt: true, resolvedAt: true, requesterId: true, assigneeId: true } }),
    db.reply.findMany({ where: { authorId: userId }, select: { id: true, ticketId: true, body: true, internal: true, createdAt: true } }),
    db.event.findMany({ where: { actorId: userId }, select: { id: true, ticketId: true, action: true, detail: true, ip: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
    db.asset.findMany({ where: { ownerId: userId }, select: { id: true, tag: true, type: true, model: true, status: true } }),
    db.outbox.findMany({ where: { recipientId: userId }, select: { id: true, kind: true, status: true, createdAt: true, sentAt: true, ticketId: true } }),
    db.aiUsage.groupBy({ by: ['operation', 'outcome'], where: { userId }, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true } }),
    db.session.findMany({ where: { userId }, select: { id: true, createdAt: true, lastSeenAt: true, ip: true, userAgent: true } }),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    profile: user,
    tickets,
    replies,
    auditEvents: events,
    assets,
    notifications,
    aiUsageSummary: aiUsage.map((g) => ({ operation: g.operation, outcome: g.outcome, calls: g._count._all, inputTokens: g._sum.inputTokens ?? 0, outputTokens: g._sum.outputTokens ?? 0 })),
    sessions,
    notes: [
      'AI prompts and answers are never stored; only usage counts and token totals exist.',
      'Ticket text authored by other people is included only where this person is the requester or assignee.',
    ],
  };
}

const sendExport = (res: Response, data: unknown, id: string) => {
  res.setHeader('Content-Disposition', `attachment; filename="opspilot-user-${id.slice(0, 8)}.json"`);
  res.json(data);
};

/** A person can always take a copy of their own data. */
governanceRouter.get('/auth/export', async (req, res) => {
  const data = await exportUserData(res.locals.user.id);
  await audit(db, { actorId: res.locals.user.id, action: 'DATA_EXPORTED', detail: 'Self-service export of personal data', ip: clientIp(req) });
  sendExport(res, data, res.locals.user.id);
});

governanceRouter.get('/admin/users/:id/export', admin, async (req, res) => {
  const id = idOf(req);
  const data = await exportUserData(id);
  if (!data) fail(404, 'User not found');
  await audit(db, { actorId: res.locals.user.id, action: 'DATA_EXPORTED', detail: `Personal data of user ${id} exported by an administrator`, ip: clientIp(req) });
  sendExport(res, data, id);
});

/* ── Erasure ────────────────────────────────────────────────────────────── */

export const ERASURE_SUMMARY = {
  removed: ['name', 'email address', 'password', 'second-factor secret and recovery codes', 'sessions', 'password reset tokens', 'queued notifications', 'source addresses on audit events', 'asset ownership'],
  retained: ['tickets, replies and notes (attributed to "Deleted user")', 'audit events (actor shown as "Deleted user")', 'AI usage counts (no content was ever stored)'],
} as const;

const eraseSchema = z.object({ confirmEmail: z.email().transform((v) => v.toLowerCase()) }).strict();

governanceRouter.post('/admin/users/:id/erase', admin, async (req, res) => {
  const id = idOf(req);
  const { confirmEmail } = eraseSchema.parse(req.body);
  if (id === res.locals.user.id) fail(400, 'You cannot erase your own account');
  const user = await db.user.findUnique({ where: { id } });
  if (!user || user.deletedAt) fail(404, 'User not found');
  if (user.email !== confirmEmail) fail(400, 'The confirmation email address does not match');
  const passwordHash = await hashPassword(randomBytes(32).toString('hex'));
  const now = new Date();
  await db.$transaction(async (tx) => {
    // Open tickets assigned to this person go back to the queue.
    await tx.ticket.updateMany({ where: { assigneeId: id, status: { notIn: ['RESOLVED', 'CLOSED'] } }, data: { assigneeId: null } });
    await tx.asset.updateMany({ where: { ownerId: id }, data: { ownerId: null } });
    await tx.outbox.deleteMany({ where: { recipientId: id, status: { in: ['PENDING', 'PROCESSING'] } } });
    await tx.session.deleteMany({ where: { userId: id } });
    await tx.passwordReset.deleteMany({ where: { userId: id } });
    await tx.recoveryCode.deleteMany({ where: { userId: id } });
    await tx.event.updateMany({ where: { actorId: id }, data: { ip: null } });
    await tx.user.update({ where: { id }, data: { name: 'Deleted user', email: `deleted-${id}@erased.invalid`, passwordHash, active: false, mfaEnabled: false, mfaSecret: null, mfaPendingSecret: null, mfaLastStep: null, failedLogins: 0, lockedUntil: null, mustChangePassword: false, deletedAt: now } });
    await audit(tx, { actorId: res.locals.user.id, action: 'USER_ERASED', detail: `User ${id} erased: personal identifiers removed, credentials destroyed, records retained under "Deleted user"`, ip: clientIp(req) });
  });
  res.json({ erased: id, at: now, ...ERASURE_SUMMARY });
});

/* ── Retention ──────────────────────────────────────────────────────────── */

const daysAgo = (days: number, now: Date) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

export async function retentionPreview(now = new Date()) {
  const [audit, aiUsage, outbox, sessions, resets] = await Promise.all([
    config.RETENTION_AUDIT_DAYS ? db.event.count({ where: { createdAt: { lt: daysAgo(config.RETENTION_AUDIT_DAYS, now) }, ticketId: null } }) : 0,
    config.RETENTION_AI_USAGE_DAYS ? db.aiUsage.count({ where: { createdAt: { lt: daysAgo(config.RETENTION_AI_USAGE_DAYS, now) } } }) : 0,
    config.RETENTION_OUTBOX_DAYS ? db.outbox.count({ where: { createdAt: { lt: daysAgo(config.RETENTION_OUTBOX_DAYS, now) }, status: { in: ['SENT', 'CANCELLED', 'FAILED'] } } }) : 0,
    db.session.count({ where: { expiresAt: { lt: now } } }),
    db.passwordReset.count({ where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] } }),
  ]);
  return {
    policy: { auditDays: config.RETENTION_AUDIT_DAYS, aiUsageDays: config.RETENTION_AI_USAGE_DAYS, outboxDays: config.RETENTION_OUTBOX_DAYS },
    eligible: { auditEvents: audit, aiUsage, outbox, expiredSessions: sessions, staleResets: resets },
    note: 'Audit events attached to a ticket are kept for as long as the ticket exists; only standalone security and administrative events age out.',
  };
}

/**
 * Applies the retention policy. Ticket-bound audit events are never pruned here: they are part of
 * the ticket's record. Zero for any setting means "keep forever".
 */
export async function runRetention(clock: Clock = systemClock, actorId: string | null = null) {
  const now = clock.now();
  const result = await db.$transaction(async (tx) => {
    const audit = config.RETENTION_AUDIT_DAYS ? (await tx.event.deleteMany({ where: { createdAt: { lt: daysAgo(config.RETENTION_AUDIT_DAYS, now) }, ticketId: null, action: { not: 'RETENTION_RUN' } } })).count : 0;
    const aiUsage = config.RETENTION_AI_USAGE_DAYS ? (await tx.aiUsage.deleteMany({ where: { createdAt: { lt: daysAgo(config.RETENTION_AI_USAGE_DAYS, now) } } })).count : 0;
    const outbox = config.RETENTION_OUTBOX_DAYS ? (await tx.outbox.deleteMany({ where: { createdAt: { lt: daysAgo(config.RETENTION_OUTBOX_DAYS, now) }, status: { in: ['SENT', 'CANCELLED', 'FAILED'] } } })).count : 0;
    const sessions = (await tx.session.deleteMany({ where: { expiresAt: { lt: now } } })).count;
    const resets = (await tx.passwordReset.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] } })).count;
    const removed = { auditEvents: audit, aiUsage, outbox, expiredSessions: sessions, staleResets: resets };
    if (Object.values(removed).some((n) => n > 0) || actorId)
      await tx.event.create({ data: { actorId, action: 'RETENTION_RUN', detail: `Retention applied: ${JSON.stringify(removed)}`, createdAt: now } });
    return removed;
  });
  log('info', 'retention run', { ...result, triggeredBy: actorId ?? 'scheduler' });
  return result;
}

governanceRouter.get('/admin/retention', admin, async (_req, res) => res.json(await retentionPreview()));
governanceRouter.post('/admin/retention/run', admin, async (req, res) => {
  z.object({}).strict().parse(req.body);
  res.json(await runRetention(systemClock, res.locals.user.id));
});
governanceRouter.get('/admin/erasure-policy', admin, (_req, res) => res.json(ERASURE_SUMMARY));

/**
 * Security posture, as facts. These are the protections the server is running with — session
 * lifetime, lockout, rate limit, second-factor requirement, password floor — read from the
 * configuration the process started with, plus what the accounts currently look like. Nothing here
 * is a switch: changing a value means changing the environment and restarting, and the page says
 * so. Secrets are never included.
 */
governanceRouter.get('/admin/security', admin, async (_req, res) => {
  const [accounts, mfaOn, locked, mustChange, disabled, sessions] = await Promise.all([
    db.user.count({ where: { deletedAt: null } }),
    db.user.count({ where: { deletedAt: null, mfaEnabled: true } }),
    db.user.count({ where: { deletedAt: null, lockedUntil: { gt: new Date() } } }),
    db.user.count({ where: { deletedAt: null, mustChangePassword: true } }),
    db.user.count({ where: { deletedAt: null, active: false } }),
    db.session.count({ where: { expiresAt: { gt: new Date() }, mfaPending: false } }),
  ]);
  res.json({
    policy: {
      sessionHours: config.SESSION_HOURS,
      lockoutThreshold: config.LOCKOUT_THRESHOLD,
      lockoutMinutes: config.LOCKOUT_MINUTES,
      loginRateLimitPer15Min: config.LOGIN_RATE_LIMIT,
      mfaRequiredRoles: config.MFA_REQUIRED_ROLES.split(',').map((r) => r.trim()).filter(Boolean),
      passwordMinLength: 12,
      secureCookies: config.NODE_ENV === 'production',
      environment: config.NODE_ENV,
    },
    accounts: { total: accounts, mfaEnabled: mfaOn, locked, mustChangePassword: mustChange, disabled, activeSessions: sessions },
  });
});
