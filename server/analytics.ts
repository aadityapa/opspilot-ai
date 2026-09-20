/**
 * Service Intelligence: how the service is performing over time.
 *
 * The Command Center (`/operations/summary`) answers "what needs action now". This endpoint answers
 * "how are we doing", which needs the previous period next to the current one, day-by-day series,
 * and breakdowns over a window rather than over the live queue. Every figure is counted from stored
 * tickets, SLA rows and ratings under the same SLA evaluation the rest of the API uses. Nothing is
 * estimated, and a comparison is reported only when both periods actually have a value.
 *
 * Support roles only.
 */
import { heavyReadLimit } from './limits.js';
import { Router } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { staff, person } from './http.js';
import { evaluateSla, slaPosition, systemClock, type Clock } from './sla.js';
import { priorities, ticketTypes, type Analytics } from '../shared/model.js';

const DAY = 86_400_000;
export const analyticsQuery = z.object({
  days: z.coerce.number().int().min(7).max(365).default(30),
  departmentId: z.uuid().optional(),
  type: z.enum(ticketTypes).optional(),
  priority: z.enum(priorities).optional(),
});
const finished = (status: string) => ['RESOLVED', 'CLOSED'].includes(status);
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const inWindow = (d: Date | null, start: Date, end: Date) => !!d && d > start && d <= end;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
const round2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
/** A comparison exists only when both sides do; the sign says which way the metric moved. */
const delta = (now: number | null, before: number | null) => (now === null || before === null ? null : round2(now - before));

export function analyticsRouter(clock: Clock = systemClock) {
  const router = Router();
  router.get('/analytics', staff, heavyReadLimit, async (req, res) => {
    const f = analyticsQuery.parse(req.query);
    const now = clock.now();
    const from = new Date(now.getTime() - f.days * DAY);
    const previousFrom = new Date(from.getTime() - f.days * DAY);
    const where = {
      ...(f.departmentId ? { requester: { departmentId: f.departmentId } } : {}),
      ...(f.type ? { type: f.type } : {}),
      ...(f.priority ? { priority: f.priority } : {}),
    };
    // Only rows that can affect either period: anything still open, or resolved after the previous
    // period began. A ticket resolved before that contributes to no figure here, so it is not read.
    const relevant = { ...where, OR: [{ resolvedAt: null }, { resolvedAt: { gte: previousFrom } }] };
    const [tickets, departments, surveys] = await Promise.all([
      db.ticket.findMany({ where: relevant, include: { category: { select: { id: true, name: true } }, assignee: { select: person }, requester: { select: { ...person, departmentId: true } }, sla: true, catalogItem: { select: { id: true, name: true } } } }),
      db.department.findMany({ select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
      db.survey.findMany({ where: { createdAt: { gte: previousFrom }, ticket: where }, select: { score: true, createdAt: true, ticket: { select: { id: true, assigneeId: true, requester: { select: { departmentId: true } } } } } }),
    ]);
    const deptName = new Map(departments.map((d) => [d.id, d.name]));

    // Per-ticket SLA outcome, evaluated once.
    const outcome = new Map(tickets.map((t) => {
      if (!t.sla) return [t.id, null] as const;
      const e = evaluateSla(t.sla, now);
      const breachAt = [e.responseBreachAt, e.resolutionBreachAt].filter(Boolean).map((d) => (d as Date).getTime());
      return [t.id, { responseBreached: !!e.responseBreachAt, resolutionBreached: !!e.resolutionBreachAt, breached: breachAt.length > 0, breachedAt: breachAt.length ? new Date(Math.min(...breachAt)) : null, responseMeasured: !!t.sla.responseSatisfiedAt }] as const;
    }));

    const period = (start: Date, end: Date) => {
      const created = tickets.filter((t) => inWindow(t.createdAt, start, end));
      const resolved = tickets.filter((t) => inWindow(t.resolvedAt, start, end));
      const measured = resolved.filter((t) => outcome.get(t.id));
      const met = measured.filter((t) => !outcome.get(t.id)!.resolutionBreached);
      const responded = tickets.filter((t) => t.sla?.responseSatisfiedAt && inWindow(t.sla.responseSatisfiedAt, start, end));
      const respondedInTarget = responded.filter((t) => !outcome.get(t.id)!.responseBreached);
      const ratings = surveys.filter((s) => inWindow(s.createdAt, start, end));
      const mttr = avg(resolved.map((t) => (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 60000));
      const firstResponse = avg(responded.map((t) => (t.sla!.responseSatisfiedAt!.getTime() - t.createdAt.getTime()) / 60000));
      // Backlog at the end of the period: created by then and not yet resolved by then.
      const backlog = tickets.filter((t) => t.createdAt <= end && (!t.resolvedAt || t.resolvedAt > end)).length;
      return {
        created: created.length,
        resolved: resolved.length,
        resolutionRatePercent: created.length ? round1((resolved.length / created.length) * 100) : null,
        slaCompliancePercent: measured.length ? round1((met.length / measured.length) * 100) : null,
        slaMeasured: measured.length,
        responseCompliancePercent: responded.length ? round1((respondedInTarget.length / responded.length) * 100) : null,
        responseMeasured: responded.length,
        mttrMinutes: mttr === null ? null : Math.round(mttr),
        firstResponseMinutes: firstResponse === null ? null : Math.round(firstResponse),
        csat: round2(avg(ratings.map((r) => r.score))),
        csatResponses: ratings.length,
        backlog,
      };
    };
    const current = period(from, now);
    const previous = period(previousFrom, from);

    // Day-by-day series over the window. Each ticket is bucketed once by the day it was created,
    // resolved and breached, and the backlog is a running count over sorted timestamps, so the cost
    // is proportional to tickets plus days rather than their product (10k tickets × 365 days took
    // seconds before this).
    const series: Analytics['series'] = [];
    type Bucket = { created: number; resolved: number; measured: number; met: number; mttrSum: number; breaches: number; csatSum: number; csatN: number };
    const buckets = new Map<string, Bucket>();
    const bucket = (key: string) => { let b = buckets.get(key); if (!b) { b = { created: 0, resolved: 0, measured: 0, met: 0, mttrSum: 0, breaches: 0, csatSum: 0, csatN: 0 }; buckets.set(key, b); } return b; };
    for (const t of tickets) {
      bucket(dayKey(t.createdAt)).created++;
      if (t.resolvedAt) {
        const b = bucket(dayKey(t.resolvedAt));
        b.resolved++;
        b.mttrSum += (t.resolvedAt.getTime() - t.createdAt.getTime()) / 60000;
        const o = outcome.get(t.id);
        if (o) { b.measured++; if (!o.resolutionBreached) b.met++; }
      }
      const at = outcome.get(t.id)?.breachedAt;
      if (at) bucket(dayKey(at)).breaches++;
    }
    for (const r of surveys) { const b = bucket(dayKey(r.createdAt)); b.csatSum += r.score; b.csatN++; }
    const createdTimes = tickets.map((t) => t.createdAt.getTime()).sort((x, y) => x - y);
    const resolvedTimes = tickets.filter((t) => t.resolvedAt).map((t) => t.resolvedAt!.getTime()).sort((x, y) => x - y);
    let ci = 0, ri = 0;
    for (let i = f.days - 1; i >= 0; i--) {
      const dayEnd = new Date(now.getTime() - i * DAY);
      const endMs = dayEnd.getTime();
      while (ci < createdTimes.length && createdTimes[ci] <= endMs) ci++;
      while (ri < resolvedTimes.length && resolvedTimes[ri] <= endMs) ri++;
      const backlog = ci - ri; // created by then, minus resolved by then
      const b = buckets.get(dayKey(dayEnd)) ?? { created: 0, resolved: 0, measured: 0, met: 0, mttrSum: 0, breaches: 0, csatSum: 0, csatN: 0 };
      series.push({
        day: dayKey(dayEnd), created: b.created, resolved: b.resolved, backlog,
        slaPercent: b.measured ? round1((b.met / b.measured) * 100) : null, slaMeasured: b.measured,
        csat: b.csatN ? round2(b.csatSum / b.csatN) : null, csatResponses: b.csatN,
        mttrMinutes: b.resolved ? Math.round(b.mttrSum / b.resolved) : null,
        breaches: b.breaches,
      });
    }

    // Demand: work raised in the window, broken down.
    const createdInWindow = tickets.filter((t) => inWindow(t.createdAt, from, now));
    const countBy = <T>(items: T[], key: (t: T) => string) => { const out = new Map<string, number>(); for (const i of items) out.set(key(i), (out.get(key(i)) ?? 0) + 1); return out; };
    const demandDept = countBy(createdInWindow, (t) => t.requester.departmentId ?? '');
    const demand: Analytics['demand'] = {
      byDepartment: [...demandDept.entries()].map(([id, n]) => ({ id: id || null, name: id ? deptName.get(id) ?? 'Unknown' : 'No department', created: n, byType: Object.fromEntries(ticketTypes.map((ty) => [ty, createdInWindow.filter((t) => (t.requester.departmentId ?? '') === id && t.type === ty).length])) })).sort((a, b) => b.created - a.created),
      byType: Object.fromEntries(ticketTypes.map((ty) => [ty, createdInWindow.filter((t) => t.type === ty).length])),
      byPriority: Object.fromEntries(priorities.map((p) => [p, createdInWindow.filter((t) => t.priority === p).length])),
      byCategory: [...countBy(createdInWindow, (t) => t.category.id).entries()].map(([id, n]) => ({ id, name: createdInWindow.find((t) => t.category.id === id)!.category.name, created: n })).sort((a, b) => b.created - a.created),
      byService: [...countBy(createdInWindow.filter((t) => t.catalogItem), (t) => t.catalogItem!.id).entries()].map(([id, n]) => ({ id, name: createdInWindow.find((t) => t.catalogItem?.id === id)!.catalogItem!.name, created: n })).sort((a, b) => b.created - a.created),
      // Department × priority, for the heatmap.
      heat: departments.map((d) => ({ id: d.id, name: d.name, cells: Object.fromEntries(priorities.map((p) => [p, createdInWindow.filter((t) => t.requester.departmentId === d.id && t.priority === p).length])) })).filter((r) => Object.values(r.cells).some((n) => n > 0)),
    };

    // SLA: where the misses are. A breach counts in the window if it happened in the window.
    const breachedInWindow = tickets.filter((t) => { const o = outcome.get(t.id); return o?.breachedAt && inWindow(o.breachedAt, from, now); });
    const active = tickets.filter((t) => !finished(t.status));
    const positions = new Map(active.map((t) => [t.id, slaPosition(t, now)]));
    const sla: Analytics['sla'] = {
      resolutionCompliancePercent: current.slaCompliancePercent, resolutionMeasured: current.slaMeasured,
      responseCompliancePercent: current.responseCompliancePercent, responseMeasured: current.responseMeasured,
      breaches: breachedInWindow.length,
      responseBreaches: breachedInWindow.filter((t) => outcome.get(t.id)!.responseBreached).length,
      resolutionBreaches: breachedInWindow.filter((t) => outcome.get(t.id)!.resolutionBreached).length,
      activeBreached: active.filter((t) => positions.get(t.id)!.breached).length,
      activeAtRisk: active.filter((t) => positions.get(t.id)!.atRisk).length,
      byDepartment: departments.map((d) => {
        const mine = tickets.filter((t) => t.requester.departmentId === d.id);
        const measured = mine.filter((t) => inWindow(t.resolvedAt, from, now) && outcome.get(t.id));
        return { id: d.id, name: d.name, breaches: breachedInWindow.filter((t) => t.requester.departmentId === d.id).length, measured: measured.length, compliancePercent: measured.length ? round1((measured.filter((t) => !outcome.get(t.id)!.resolutionBreached).length / measured.length) * 100) : null, activeAtRisk: mine.filter((t) => positions.get(t.id)?.atRisk).length };
      }).filter((d) => d.breaches || d.measured || d.activeAtRisk).sort((a, b) => b.breaches - a.breaches),
      byPriority: priorities.map((p) => {
        const mine = tickets.filter((t) => t.priority === p);
        const measured = mine.filter((t) => inWindow(t.resolvedAt, from, now) && outcome.get(t.id));
        return { priority: p, breaches: breachedInWindow.filter((t) => t.priority === p).length, measured: measured.length, compliancePercent: measured.length ? round1((measured.filter((t) => !outcome.get(t.id)!.resolutionBreached).length / measured.length) * 100) : null, activeAtRisk: mine.filter((t) => positions.get(t.id)?.atRisk).length };
      }),
      recentBreaches: breachedInWindow.sort((a, b) => outcome.get(b.id)!.breachedAt!.getTime() - outcome.get(a.id)!.breachedAt!.getTime()).slice(0, 8).map((t) => ({ id: t.id, number: t.number, title: t.title, priority: t.priority, status: t.status, department: t.requester.departmentId ? deptName.get(t.requester.departmentId) ?? null : null, kind: outcome.get(t.id)!.responseBreached ? 'RESPONSE' as const : 'RESOLUTION' as const, breachedAt: outcome.get(t.id)!.breachedAt!.toISOString() })),
    };

    // Resolution: how long things take, and how old what is left is.
    const ageBuckets = [['< 4h', 0, 4], ['4–8h', 4, 8], ['8–24h', 8, 24], ['1–3d', 24, 72], ['3d+', 72, Infinity]] as const;
    const resolution: Analytics['resolution'] = {
      mttrMinutes: current.mttrMinutes, previousMttrMinutes: previous.mttrMinutes,
      resolvedInWindow: current.resolved, backlog: current.backlog, previousBacklog: previous.backlog,
      ageDistribution: ageBuckets.map(([label, lo, hi]) => ({ label, count: active.filter((t) => { const h = (now.getTime() - t.createdAt.getTime()) / 3600000; return h >= lo && h < hi; }).length })),
      oldestOpen: [...active].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).slice(0, 6).map((t) => ({ id: t.id, number: t.number, title: t.title, priority: t.priority, status: t.status, assignee: t.assignee, ageMs: now.getTime() - t.createdAt.getTime(), department: t.requester.departmentId ? deptName.get(t.requester.departmentId) ?? null : null })),
      byPriority: priorities.map((p) => { const done = tickets.filter((t) => t.priority === p && inWindow(t.resolvedAt, from, now)); return { priority: p, resolved: done.length, mttrMinutes: done.length ? Math.round(avg(done.map((t) => (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 60000))!) : null }; }),
    };

    // Satisfaction. Small samples are reported with their size so the interface can say so.
    const ratingsNow = surveys.filter((s) => inWindow(s.createdAt, from, now));
    const distribution: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    for (const r of ratingsNow) distribution[String(r.score)] += 1;
    const csat: Analytics['csat'] = {
      average: current.csat, previousAverage: previous.csat, responses: ratingsNow.length, previousResponses: previous.csatResponses,
      distribution,
      byDepartment: departments.map((d) => { const rows = ratingsNow.filter((r) => r.ticket.requester.departmentId === d.id); return { id: d.id, name: d.name, responses: rows.length, average: round2(avg(rows.map((r) => r.score))) }; }).filter((d) => d.responses > 0).sort((a, b) => b.responses - a.responses),
      lowRated: ratingsNow.filter((r) => r.score <= 2).length,
    };

    // Team: operational context per engineer. Alphabetical on purpose — this is not a leaderboard.
    const engineers = new Map<string, { id: string; name: string }>();
    for (const t of tickets) if (t.assignee) engineers.set(t.assignee.id, t.assignee);
    const team: Analytics['team'] = [...engineers.values()].map((e) => {
      const mine = tickets.filter((t) => t.assigneeId === e.id);
      const open = mine.filter((t) => !finished(t.status));
      const done = mine.filter((t) => inWindow(t.resolvedAt, from, now));
      const measured = done.filter((t) => outcome.get(t.id));
      const rated = surveys.filter((s) => s.ticket.assigneeId === e.id && inWindow(s.createdAt, from, now));
      return {
        id: e.id, name: e.name,
        assigned: open.length, atRisk: open.filter((t) => positions.get(t.id)?.atRisk).length, breached: open.filter((t) => positions.get(t.id)?.breached).length,
        resolved: done.length,
        slaCompliancePercent: measured.length ? round1((measured.filter((t) => !outcome.get(t.id)!.resolutionBreached).length / measured.length) * 100) : null, slaMeasured: measured.length,
        mttrMinutes: done.length ? Math.round(avg(done.map((t) => (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 60000))!) : null,
        csat: round2(avg(rated.map((r) => r.score))), csatResponses: rated.length,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    const out: Analytics = {
      generatedAt: now.toISOString(),
      window: { days: f.days, from: from.toISOString(), to: now.toISOString(), previousFrom: previousFrom.toISOString(), departmentId: f.departmentId ?? null, type: f.type ?? null, priority: f.priority ?? null },
      headline: {
        slaCompliance: { value: current.slaCompliancePercent, previous: previous.slaCompliancePercent, delta: delta(current.slaCompliancePercent, previous.slaCompliancePercent), measured: current.slaMeasured },
        mttrMinutes: { value: current.mttrMinutes, previous: previous.mttrMinutes, delta: delta(current.mttrMinutes, previous.mttrMinutes), measured: current.resolved },
        csat: { value: current.csat, previous: previous.csat, delta: delta(current.csat, previous.csat), measured: current.csatResponses },
        resolutionRate: { value: current.resolutionRatePercent, previous: previous.resolutionRatePercent, delta: delta(current.resolutionRatePercent, previous.resolutionRatePercent), measured: current.created },
        backlog: { value: current.backlog, previous: previous.backlog, delta: delta(current.backlog, previous.backlog), measured: current.backlog },
        firstResponseMinutes: { value: current.firstResponseMinutes, previous: previous.firstResponseMinutes, delta: delta(current.firstResponseMinutes, previous.firstResponseMinutes), measured: current.responseMeasured },
      },
      series, demand, sla, resolution, csat, team,
    };
    res.json(out);
  });
  return router;
}
