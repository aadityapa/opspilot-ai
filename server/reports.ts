/**
 * Reports: precise, filterable, exportable evidence.
 *
 * Analytics shows trends; a report is the rows behind them. Every kind here is a plain query over
 * stored data under the same filters, returned as columns and rows the interface can table, or as
 * CSV with `?format=csv`. Export runs behind the same guard and the same filters as the JSON, so
 * nothing leaves as a file that the caller could not have read on screen.
 *
 * Support roles only.
 */
import { csvLine } from './csv.js';

/** Rows returned to the screen per report; the CSV export is never capped. */
export const MAX_ROWS = 2000;
import { heavyReadLimit } from './limits.js';
import { Router } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { staff, fail } from './http.js';
import { evaluateSla, systemClock, type Clock } from './sla.js';
import { labels, priorities, ticketTypes, type Report, type ReportKind } from '../shared/model.js';

const DAY = 86_400_000;
const query = z.object({
  days: z.coerce.number().int().min(7).max(365).default(30),
  departmentId: z.uuid().optional(),
  type: z.enum(ticketTypes).optional(),
  priority: z.enum(priorities).optional(),
  format: z.enum(['json', 'csv']).default('json'),
});
const KINDS: Record<ReportKind, { title: string; description: string }> = {
  tickets: { title: 'Ticket volume', description: 'Every ticket raised in the period, with who raised it, its type, priority, status and timing.' },
  sla: { title: 'SLA performance', description: 'Resolved tickets in the period against their response and resolution targets, and active tickets already past a target.' },
  resolution: { title: 'Resolution performance', description: 'Time to first response and time to resolve for every ticket resolved in the period.' },
  csat: { title: 'Satisfaction', description: 'Every rating left in the period, with the ticket it was left on and who handled it.' },
  requests: { title: 'Request demand', description: 'Service catalog requests raised in the period, by service, with their approval outcome.' },
  departments: { title: 'Department demand', description: 'Work raised by each department in the period and what is still open from it.' },
  agents: { title: 'Agent workload', description: 'Assigned and resolved work per engineer in the period, with time to resolve. Alphabetical; not a ranking.' },
  assets: { title: 'Asset service history', description: 'Tickets in the period that reference a hardware asset.' },
};
const finished = (s: string) => ['RESOLVED', 'CLOSED'].includes(s);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const mins = (from: Date, to: Date | null | undefined) => (to ? Math.round((to.getTime() - from.getTime()) / 60000) : null);
const key = (n: number) => `OPS-${String(n).padStart(4, '0')}`;

export function reportsRouter(clock: Clock = systemClock) {
  const router = Router();
  router.get('/reports/:kind', staff, heavyReadLimit, async (req, res) => {
    const kind = req.params.kind as ReportKind;
    if (!(kind in KINDS)) fail(404, 'Unknown report');
    const f = query.parse(req.query);
    const now = clock.now();
    const from = new Date(now.getTime() - f.days * DAY);
    const where = {
      ...(f.departmentId ? { requester: { departmentId: f.departmentId } } : {}),
      ...(f.type ? { type: f.type } : {}),
      ...(f.priority ? { priority: f.priority } : {}),
    };
    const include = { category: { select: { name: true } }, assignee: { select: { id: true, name: true } }, requester: { select: { id: true, name: true, department: { select: { id: true, name: true } } } }, sla: true, catalogItem: { select: { name: true } }, asset: { select: { tag: true, model: true } }, approvals: { select: { status: true, decidedAt: true, approver: { select: { name: true } } } }, survey: { select: { score: true, comment: true, createdAt: true } } } as const;

    let columns: Report['columns'] = [];
    let rows: Report['rows'] = [];
    let summary: Report['summary'] = [];

    if (kind === 'tickets' || kind === 'requests' || kind === 'assets') {
      const tickets = await db.ticket.findMany({ where: { ...where, createdAt: { gt: from, lte: now }, ...(kind === 'requests' ? { catalogItemId: { not: null } } : {}), ...(kind === 'assets' ? { assetId: { not: null } } : {}) }, include, orderBy: { createdAt: 'desc' } });
      columns = [
        { key: 'key', label: 'Ticket', kind: 'key' }, { key: 'title', label: 'Title' },
        ...(kind === 'requests' ? [{ key: 'service', label: 'Service' }] : []),
        ...(kind === 'assets' ? [{ key: 'asset', label: 'Asset', kind: 'key' as const }, { key: 'model', label: 'Model' }] : []),
        { key: 'type', label: 'Type' }, { key: 'priority', label: 'Priority' }, { key: 'status', label: 'Status' },
        { key: 'requester', label: 'Requester' }, { key: 'department', label: 'Department' }, { key: 'assignee', label: 'Assignee' },
        ...(kind === 'requests' ? [{ key: 'approval', label: 'Approval' }, { key: 'approver', label: 'Approver' }] : []),
        { key: 'createdAt', label: 'Raised', kind: 'date' }, { key: 'resolvedAt', label: 'Resolved', kind: 'date' },
      ];
      rows = tickets.map((t) => ({
        key: key(t.number), title: t.title, service: t.catalogItem?.name ?? null, asset: t.asset?.tag ?? null, model: t.asset?.model ?? null,
        type: labels[t.type] ?? t.type, priority: labels[t.priority] ?? t.priority, status: labels[t.status] ?? t.status,
        requester: t.requester.name, department: t.requester.department?.name ?? null, assignee: t.assignee?.name ?? null,
        approval: t.approvals[0] ? labels[t.approvals[0].status] ?? t.approvals[0].status : null, approver: t.approvals[0]?.approver.name ?? null,
        createdAt: iso(t.createdAt), resolvedAt: iso(t.resolvedAt), id: t.id,
      }));
      const open = tickets.filter((t) => !finished(t.status)).length;
      summary = [{ label: kind === 'requests' ? 'Requests raised' : kind === 'assets' ? 'Asset-linked tickets' : 'Tickets raised', value: String(tickets.length) }, { label: 'Still open', value: String(open) }, { label: 'Resolved', value: String(tickets.length - open) }];
      if (kind === 'requests') summary.push({ label: 'Awaiting approval', value: String(tickets.filter((t) => t.approvals.some((a) => a.status === 'PENDING')).length) });
    } else if (kind === 'sla') {
      const tickets = await db.ticket.findMany({ where: { ...where, OR: [{ resolvedAt: { gt: from, lte: now } }, { status: { notIn: ['RESOLVED', 'CLOSED'] } }], sla: { isNot: null } }, include, orderBy: { createdAt: 'desc' } });
      columns = [{ key: 'key', label: 'Ticket', kind: 'key' }, { key: 'title', label: 'Title' }, { key: 'priority', label: 'Priority' }, { key: 'status', label: 'Status' }, { key: 'department', label: 'Department' }, { key: 'responseTarget', label: 'Response target (min)', kind: 'number' }, { key: 'responseActual', label: 'First response (min)', kind: 'number' }, { key: 'responseOutcome', label: 'Response' }, { key: 'resolutionTarget', label: 'Resolution target (min)', kind: 'number' }, { key: 'resolutionActual', label: 'Resolved in (min)', kind: 'number' }, { key: 'resolutionOutcome', label: 'Resolution' }, { key: 'createdAt', label: 'Raised', kind: 'date' }];
      let met = 0, breached = 0, activeBreached = 0;
      rows = tickets.map((t) => {
        const e = evaluateSla(t.sla!, now);
        const done = finished(t.status);
        const resolutionOutcome = done ? (e.resolutionBreachAt ? 'Breached' : 'Met') : e.resolutionBreachAt ? 'Breached (open)' : 'Running';
        if (done) { if (e.resolutionBreachAt) breached++; else met++; } else if (e.resolutionBreachAt || e.responseBreachAt) activeBreached++;
        return {
          key: key(t.number), title: t.title, priority: labels[t.priority] ?? t.priority, status: labels[t.status] ?? t.status, department: t.requester.department?.name ?? null,
          responseTarget: t.sla!.responseMinutes, responseActual: mins(t.createdAt, t.sla!.responseSatisfiedAt), responseOutcome: t.sla!.responseSatisfiedAt ? (e.responseBreachAt ? 'Breached' : 'Met') : e.responseBreachAt ? 'Breached (no reply)' : 'Waiting',
          resolutionTarget: t.sla!.resolutionMinutes, resolutionActual: mins(t.createdAt, t.resolvedAt), resolutionOutcome, createdAt: iso(t.createdAt), id: t.id,
        };
      });
      summary = [{ label: 'Resolution compliance', value: met + breached ? `${Math.round((met / (met + breached)) * 1000) / 10}%` : '—' }, { label: 'Measured', value: String(met + breached) }, { label: 'Breached (resolved)', value: String(breached) }, { label: 'Active past a target', value: String(activeBreached) }];
    } else if (kind === 'resolution') {
      const tickets = await db.ticket.findMany({ where: { ...where, resolvedAt: { gt: from, lte: now } }, include, orderBy: { resolvedAt: 'desc' } });
      columns = [{ key: 'key', label: 'Ticket', kind: 'key' }, { key: 'title', label: 'Title' }, { key: 'type', label: 'Type' }, { key: 'priority', label: 'Priority' }, { key: 'assignee', label: 'Assignee' }, { key: 'department', label: 'Department' }, { key: 'firstResponse', label: 'First response (min)', kind: 'number' }, { key: 'resolvedIn', label: 'Resolved in (min)', kind: 'number' }, { key: 'createdAt', label: 'Raised', kind: 'date' }, { key: 'resolvedAt', label: 'Resolved', kind: 'date' }];
      rows = tickets.map((t) => ({ key: key(t.number), title: t.title, type: labels[t.type] ?? t.type, priority: labels[t.priority] ?? t.priority, assignee: t.assignee?.name ?? null, department: t.requester.department?.name ?? null, firstResponse: mins(t.createdAt, t.sla?.responseSatisfiedAt), resolvedIn: mins(t.createdAt, t.resolvedAt), createdAt: iso(t.createdAt), resolvedAt: iso(t.resolvedAt), id: t.id }));
      const times = rows.map((r) => r.resolvedIn as number).filter((n) => n !== null);
      const mean = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;
      const sorted = [...times].sort((a, b) => a - b);
      const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
      summary = [{ label: 'Resolved', value: String(tickets.length) }, { label: 'Mean time to resolve', value: mean === null ? '—' : `${mean} min` }, { label: 'Median', value: median === null ? '—' : `${median} min` }];
    } else if (kind === 'csat') {
      const surveys = await db.survey.findMany({ where: { createdAt: { gt: from, lte: now }, ticket: where }, include: { ticket: { include } }, orderBy: { createdAt: 'desc' } });
      columns = [{ key: 'key', label: 'Ticket', kind: 'key' }, { key: 'title', label: 'Title' }, { key: 'score', label: 'Rating', kind: 'number' }, { key: 'comment', label: 'Comment' }, { key: 'assignee', label: 'Handled by' }, { key: 'department', label: 'Department' }, { key: 'ratedAt', label: 'Rated', kind: 'date' }];
      rows = surveys.map((s) => ({ key: key(s.ticket.number), title: s.ticket.title, score: s.score, comment: s.comment, assignee: s.ticket.assignee?.name ?? null, department: s.ticket.requester.department?.name ?? null, ratedAt: iso(s.createdAt), id: s.ticket.id }));
      const avg = surveys.length ? Math.round((surveys.reduce((a, s) => a + s.score, 0) / surveys.length) * 100) / 100 : null;
      summary = [{ label: 'Ratings', value: String(surveys.length) }, { label: 'Average', value: avg === null ? '—' : `${avg} / 5` }, { label: 'Rated 1–2', value: String(surveys.filter((s) => s.score <= 2).length) }];
    } else if (kind === 'departments') {
      const [departments, tickets] = await Promise.all([db.department.findMany({ select: { id: true, name: true, code: true, costCentre: true, manager: { select: { name: true } } }, orderBy: { name: 'asc' } }), db.ticket.findMany({ where, select: { status: true, type: true, createdAt: true, resolvedAt: true, requester: { select: { departmentId: true } } } })]);
      columns = [{ key: 'name', label: 'Department' }, { key: 'code', label: 'Code', kind: 'key' }, { key: 'costCentre', label: 'Cost centre', kind: 'key' }, { key: 'manager', label: 'Manager' }, { key: 'raised', label: 'Raised', kind: 'number' }, { key: 'incidents', label: 'Incidents', kind: 'number' }, { key: 'requests', label: 'Requests', kind: 'number' }, { key: 'resolved', label: 'Resolved', kind: 'number' }, { key: 'open', label: 'Open now', kind: 'number' }];
      rows = departments.map((d) => { const mine = tickets.filter((t) => t.requester.departmentId === d.id); const raised = mine.filter((t) => t.createdAt > from && t.createdAt <= now); return { name: d.name, code: d.code, costCentre: d.costCentre, manager: d.manager?.name ?? null, raised: raised.length, incidents: raised.filter((t) => t.type === 'INCIDENT').length, requests: raised.filter((t) => t.type === 'REQUEST').length, resolved: mine.filter((t) => t.resolvedAt && t.resolvedAt > from && t.resolvedAt <= now).length, open: mine.filter((t) => !finished(t.status)).length, id: d.id }; });
      summary = [{ label: 'Departments', value: String(departments.length) }, { label: 'Raised', value: String(rows.reduce((a, r) => a + (r.raised as number), 0)) }, { label: 'Open now', value: String(rows.reduce((a, r) => a + (r.open as number), 0)) }];
    } else if (kind === 'agents') {
      const [agents, tickets] = await Promise.all([db.user.findMany({ where: { role: { in: ['ENGINEER', 'ADMIN'] }, active: true, deletedAt: null }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } }), db.ticket.findMany({ where, select: { assigneeId: true, status: true, createdAt: true, resolvedAt: true, sla: { select: { responseSatisfiedAt: true } } } })]);
      columns = [{ key: 'name', label: 'Engineer' }, { key: 'role', label: 'Role' }, { key: 'assigned', label: 'Assigned now', kind: 'number' }, { key: 'resolved', label: 'Resolved', kind: 'number' }, { key: 'mttr', label: 'Mean time to resolve (min)', kind: 'number' }, { key: 'firstResponse', label: 'Mean first response (min)', kind: 'number' }];
      rows = agents.map((a) => { const mine = tickets.filter((t) => t.assigneeId === a.id); const done = mine.filter((t) => t.resolvedAt && t.resolvedAt > from && t.resolvedAt <= now); const responded = mine.filter((t) => t.sla?.responseSatisfiedAt); const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((x, y) => x + y, 0) / xs.length) : null); return { name: a.name, role: labels[a.role] ?? a.role, assigned: mine.filter((t) => !finished(t.status)).length, resolved: done.length, mttr: mean(done.map((t) => (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 60000)), firstResponse: mean(responded.map((t) => (t.sla!.responseSatisfiedAt!.getTime() - t.createdAt.getTime()) / 60000)), id: a.id }; });
      summary = [{ label: 'Engineers', value: String(agents.length) }, { label: 'Resolved', value: String(rows.reduce((a, r) => a + (r.resolved as number), 0)) }, { label: 'Assigned now', value: String(rows.reduce((a, r) => a + (r.assigned as number), 0)) }];
    }

    // The screen shows at most MAX_ROWS; the CSV always carries every row, so nothing is lost by the
    // cap — a year of a large workspace is simply too many rows to be read as a web table.
    const report: Report = { kind, ...KINDS[kind], generatedAt: now.toISOString(), filters: { days: f.days, departmentId: f.departmentId ?? null, type: f.type ?? null, priority: f.priority ?? null }, summary, columns, rows: rows.slice(0, MAX_ROWS), total: rows.length, truncated: rows.length > MAX_ROWS };
    if (f.format === 'csv') {
      const lines = [csvLine(columns.map((c) => c.label)), ...rows.map((r) => csvLine(columns.map((c) => r[c.key] ?? null)))];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="opspilot-${kind}-${f.days}d-${now.toISOString().slice(0, 10)}.csv"`);
      res.send(`﻿${lines.join('\r\n')}\r\n`);
      return;
    }
    res.json(report);
  });
  return router;
}
