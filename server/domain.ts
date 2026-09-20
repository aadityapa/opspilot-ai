import { transitions, type Role, type Status } from '../shared/model.js';
export const canReadTicket = (user: { id: string; role: Role }, ticket: { requesterId: string }) =>
  user.role !== 'EMPLOYEE' || user.id === ticket.requesterId;
export const canTransition = (from: Status, to: Status) => transitions[from].includes(to);
export function metrics(
  tickets: {
    status: string;
    priority: string;
    assigneeId: string | null;
    category: { name: string };
    assignee: { name: string } | null;
    createdAt: Date;
    resolvedAt: Date | null;
    firstRespondedAt: Date | null;
  }[],
) {
  const active = tickets.filter((t) => !['RESOLVED', 'CLOSED'].includes(t.status));
  const count = (items: typeof tickets, key: (t: (typeof tickets)[number]) => string) =>
    items.reduce<Record<string, number>>((a, t) => {
      const k = key(t);
      a[k] = (a[k] ?? 0) + 1;
      return a;
    }, {});
  const avg = (key: 'resolvedAt' | 'firstRespondedAt') => {
    const samples = tickets.filter((t) => t[key] !== null);
    return samples.length
      ? samples.reduce((s, t) => s + (t[key]!.getTime() - t.createdAt.getTime()) / 60000, 0) /
          samples.length
      : null;
  };
  return {
    active: active.length,
    unassigned: active.filter((t) => !t.assigneeId).length,
    resolved: tickets.filter((t) => ['RESOLVED', 'CLOSED'].includes(t.status)).length,
    total: tickets.length,
    byStatus: count(tickets, (t) => t.status),
    byPriority: count(active, (t) => t.priority),
    byCategory: count(active, (t) => t.category.name),
    workload: count(
      active.filter((t) => t.assigneeId),
      (t) => `${t.assignee!.name} (${t.assigneeId!.slice(0, 8)})`,
    ),
    firstResponseMinutes: avg('firstRespondedAt'),
    resolutionMinutes: avg('resolvedAt'),
  };
}
