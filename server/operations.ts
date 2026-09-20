/**
 * Operations summary for the command center.
 *
 * Why this exists: the dashboard needs figures the existing endpoints cannot give without the browser
 * downloading every ticket — ages of the oldest unowned and breached tickets, at-risk countdowns,
 * per-department and per-engineer load, ticket flow with a comparison window, mean time to resolve,
 * the critical-work table and the live event feed. Computing them here keeps one authoritative,
 * testable definition per figure and keeps the ticket rows on the server. Nothing is estimated:
 * every number is counted from stored rows, with the same SLA evaluation the rest of the API uses.
 *
 * Support roles only. Employees keep their own scoped `/dashboard`.
 */
import { Router } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { staff, person } from './http.js';
import { assetMetrics, assetScope } from './assets.js';
import { slaMetrics, slaPosition, slaView, systemClock, type Clock } from './sla.js';
import { priorities, ticketTypes, type OperationsSummary, type SlaView } from '../shared/model.js';

const DAY = 86_400_000;
const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(30).default(7),
  departmentId: z.uuid().optional(),
});
const finished = (status: string) => ['RESOLVED', 'CLOSED'].includes(status);
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export function operationsRouter(clock: Clock = systemClock) {
  const router = Router();
  router.get('/operations/summary', staff, async (req, res) => {
    const f = querySchema.parse(req.query);
    const now = clock.now();
    const from = new Date(now.getTime() - f.days * DAY);
    const previousFrom = new Date(from.getTime() - f.days * DAY);
    const scope = f.departmentId ? { requester: { departmentId: f.departmentId } } : {};

    const [tickets, departments, events, surveys, assets, pendingApprovals] = await Promise.all([
      // Only rows that can affect a figure here: still active, or resolved since the previous
      // period began. Older resolved tickets contribute nothing and are not read.
      db.ticket.findMany({
        where: { ...scope, OR: [{ resolvedAt: null }, { resolvedAt: { gte: previousFrom } }] },
        include: { category: { select: { id: true, name: true } }, assignee: { select: person }, requester: { select: { ...person, departmentId: true } }, sla: true },
      }),
      db.department.findMany({ select: { id: true, name: true, code: true } }),
      db.event.findMany({
        where: { ticketId: { not: null }, ...(f.departmentId ? { ticket: scope } : {}) },
        include: { actor: { select: person }, ticket: { select: { id: true, number: true, title: true, status: true, priority: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20,
      }),
      db.survey.findMany({ where: { createdAt: { gte: previousFrom }, ...(f.departmentId ? { ticket: scope } : {}) }, select: { score: true, createdAt: true } }),
      db.asset.findMany({ where: assetScope(res.locals.user), select: { id: true, status: true, type: true, ownerId: true, warrantyExpiry: true } }),
      db.approval.findMany({ where: { status: 'PENDING', ...(f.departmentId ? { ticket: scope } : {}) }, select: { createdAt: true } }),
    ]);

    const active = tickets.filter((t) => !finished(t.status));
    const positions = new Map(active.map((t) => [t.id, slaPosition(t, now)]));
    const unassigned = active.filter((t) => !t.assigneeId);
    const atRiskTickets = active.filter((t) => positions.get(t.id)!.atRisk);
    const breachedTickets = active.filter((t) => positions.get(t.id)!.breached);
    const countBy = <T>(items: T[], key: (t: T) => string, keys?: readonly string[]) => {
      const out: Record<string, number> = Object.fromEntries((keys ?? []).map((k) => [k, 0]));
      for (const i of items) out[key(i)] = (out[key(i)] ?? 0) + 1;
      return out;
    };
    const oldest = (items: { createdAt: Date }[]) => (items.length ? now.getTime() - Math.min(...items.map((t) => t.createdAt.getTime())) : null);

    // Flow: created and resolved inside the window, and inside the window before it.
    // Half-open on the left so a boundary instant belongs to exactly one window; the current instant counts.
    const inWindow = (d: Date | null, start: Date, end: Date) => !!d && d > start && d <= end;
    const created = tickets.filter((t) => inWindow(t.createdAt, from, now)).length;
    const resolved = tickets.filter((t) => inWindow(t.resolvedAt, from, now)).length;
    const previousCreated = tickets.filter((t) => inWindow(t.createdAt, previousFrom, from)).length;
    const previousResolved = tickets.filter((t) => inWindow(t.resolvedAt, previousFrom, from)).length;
    // Bucket each ticket once rather than scanning every ticket for every day.
    const createdByDay = new Map<string, number>();
    const resolvedByDay = new Map<string, number>();
    for (const t of tickets) {
      const c = dayKey(t.createdAt); createdByDay.set(c, (createdByDay.get(c) ?? 0) + 1);
      if (t.resolvedAt) { const r = dayKey(t.resolvedAt); resolvedByDay.set(r, (resolvedByDay.get(r) ?? 0) + 1); }
    }
    const perDay: OperationsSummary['flow']['perDay'] = [];
    for (let i = f.days - 1; i >= 0; i--) {
      const key = dayKey(new Date(now.getTime() - i * DAY));
      perDay.push({ day: key, created: createdByDay.get(key) ?? 0, resolved: resolvedByDay.get(key) ?? 0 });
    }
    const mttr = (start: Date, end: Date) => {
      const done = tickets.filter((t) => inWindow(t.resolvedAt, start, end));
      return done.length ? Math.round(done.reduce((s, t) => s + (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 60000, 0) / done.length) : null;
    };
    const csatIn = (start: Date, end: Date) => {
      const rows = surveys.filter((s) => inWindow(s.createdAt, start, end));
      return { responses: rows.length, average: rows.length ? Math.round((rows.reduce((s, r) => s + r.score, 0) / rows.length) * 100) / 100 : null };
    };

    const byDepartment = departments.map((d) => {
      const mine = active.filter((t) => t.requester.departmentId === d.id);
      return {
        id: d.id, name: d.name, code: d.code,
        active: mine.length,
        unassigned: mine.filter((t) => !t.assigneeId).length,
        atRisk: mine.filter((t) => positions.get(t.id)!.atRisk).length,
        breached: mine.filter((t) => positions.get(t.id)!.breached).length,
        created: tickets.filter((t) => t.requester.departmentId === d.id && inWindow(t.createdAt, from, now)).length,
      };
    }).filter((d) => d.active || d.created).sort((a, b) => b.active - a.active || b.created - a.created);
    const noDepartment = active.filter((t) => !t.requester.departmentId);
    // Service areas are ticket categories: the closest thing to a service the workspace records.
    const categoryRows = new Map<string, { id: string; name: string; active: number; unassigned: number; atRisk: number; breached: number }>();
    for (const t of active) {
      const row = categoryRows.get(t.category.id) ?? { id: t.category.id, name: t.category.name, active: 0, unassigned: 0, atRisk: 0, breached: 0 };
      row.active++;
      if (!t.assigneeId) row.unassigned++;
      const p = positions.get(t.id)!;
      if (p.atRisk) row.atRisk++;
      if (p.breached) row.breached++;
      categoryRows.set(t.category.id, row);
    }

    const engineerRows = new Map<string, { id: string; name: string; active: number; atRisk: number; breached: number; urgent: number }>();
    for (const t of active) {
      if (!t.assignee) continue;
      const row = engineerRows.get(t.assignee.id) ?? { id: t.assignee.id, name: t.assignee.name, active: 0, atRisk: 0, breached: 0, urgent: 0 };
      row.active++;
      const p = positions.get(t.id)!;
      if (p.atRisk) row.atRisk++;
      if (p.breached) row.breached++;
      if (t.priority === 'URGENT') row.urgent++;
      engineerRows.set(t.assignee.id, row);
    }

    const severity = (t: (typeof active)[number]) => {
      const p = positions.get(t.id)!;
      return (p.breached ? 0 : p.atRisk ? 1 : 2) * 10 + priorities.indexOf(t.priority as (typeof priorities)[number]);
    };
    const critical = active
      .filter((t) => ['URGENT', 'HIGH'].includes(t.priority) || positions.get(t.id)!.atRisk || positions.get(t.id)!.breached)
      .sort((a, b) => severity(a) - severity(b) || (positions.get(a.id)!.remainingMs ?? Infinity) - (positions.get(b.id)!.remainingMs ?? Infinity) || a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, 10)
      .map((t) => ({
        id: t.id, number: t.number, title: t.title, type: t.type, priority: t.priority, status: t.status,
        category: t.category.name, assignee: t.assignee, createdAt: t.createdAt.toISOString(), ageMs: now.getTime() - t.createdAt.getTime(),
        // Dates serialise to ISO strings on the wire, which is what the shared SlaView type describes.
        sla: t.sla ? (slaView(t.sla, now, t.status) as unknown as SlaView) : null,
        position: { breached: positions.get(t.id)!.breached, atRisk: positions.get(t.id)!.atRisk, remainingMs: positions.get(t.id)!.remainingMs },
      }));

    const summary: OperationsSummary = {
      generatedAt: now.toISOString(),
      window: { days: f.days, from: from.toISOString(), to: now.toISOString(), departmentId: f.departmentId ?? null },
      active: {
        total: active.length,
        unassigned: unassigned.length,
        unassignedByPriority: countBy(unassigned, (t) => t.priority, priorities),
        oldestUnassignedAgeMs: oldest(unassigned),
        byPriority: countBy(active, (t) => t.priority, priorities),
        byType: countBy(active, (t) => t.type, ticketTypes),
        byStatus: countBy(active, (t) => t.status),
        withAsset: active.filter((t) => t.assetId).length,
      },
      sla: {
        ...slaMetrics(tickets, now),
        atRisk: atRiskTickets.length,
        atRiskUnder30Min: atRiskTickets.filter((t) => (positions.get(t.id)!.remainingMs ?? Infinity) <= 30 * 60000).length,
        oldestBreachAgeMs: breachedTickets.length ? now.getTime() - Math.min(...breachedTickets.map((t) => positions.get(t.id)!.breachedAt!.getTime())) : null,
      },
      flow: { created, resolved, previousCreated, previousResolved, perDay, backlogChange: created - resolved, resolutionRatePercent: created ? Math.round((resolved / created) * 1000) / 10 : null },
      mttrMinutes: mttr(from, now),
      previousMttrMinutes: mttr(previousFrom, from),
      csat: { ...csatIn(from, now), previousAverage: csatIn(previousFrom, from).average },
      approvals: { pending: pendingApprovals.length, oldestPendingAgeMs: oldest(pendingApprovals) },
      departments: byDepartment,
      unplaced: { active: noDepartment.length, unassigned: noDepartment.filter((t) => !t.assigneeId).length },
      categories: [...categoryRows.values()].sort((a, b) => (b.breached - a.breached) || (b.atRisk - a.atRisk) || (b.active - a.active)),
      engineers: [...engineerRows.values()].sort((a, b) => b.active - a.active),
      critical,
      activity: events.map((e) => ({ id: e.id, at: e.createdAt.toISOString(), action: e.action, detail: e.detail, actor: e.actor, ticket: e.ticket ? { id: e.ticket.id, number: e.ticket.number, title: e.ticket.title, status: e.ticket.status, priority: e.ticket.priority } : null })),
      assets: { ...assetMetrics(assets, now), linkedToActiveTickets: active.filter((t) => t.assetId).length },
    };
    res.json(summary);
  });
  return router;
}
