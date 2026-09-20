import { describe, it, expect } from 'vitest';
import { canReadTicket, canTransition, metrics } from '../server/domain.js';
import { ticketSchema } from '../shared/contracts.js';
describe('authorization and lifecycle', () => {
  it('limits employee reads to their own tickets', () => {
    expect(canReadTicket({ id: 'a', role: 'EMPLOYEE' }, { requesterId: 'b' })).toBe(false);
    expect(canReadTicket({ id: 'a', role: 'EMPLOYEE' }, { requesterId: 'a' })).toBe(true);
    expect(canReadTicket({ id: 'a', role: 'ENGINEER' }, { requesterId: 'b' })).toBe(true);
  });
  it('requires controlled transitions and permits reopening', () => {
    expect(canTransition('OPEN', 'CLOSED')).toBe(false);
    expect(canTransition('OPEN', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('CLOSED', 'OPEN')).toBe(true);
    expect(canTransition('RESOLVED', 'CLOSED')).toBe(true);
  });
  it('rejects owner and status injection during creation', () => {
    expect(
      ticketSchema.safeParse({
        title: 'Valid ticket',
        description: 'Valid long description',
        categoryId: '38d5b8f3-b3d9-4447-882c-0bc2fe2fe9db',
        requesterId: 'someone-else',
      }).success,
    ).toBe(false);
  });
  it('calculates metrics from dated records and excludes reopened resolutions', () => {
    const base = {
      priority: 'HIGH',
      category: { name: 'Network' },
      assigneeId: null,
      assignee: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      firstRespondedAt: null,
      resolvedAt: null,
    };
    const result = metrics([
      { ...base, status: 'OPEN' },
      {
        ...base,
        status: 'RESOLVED',
        firstRespondedAt: new Date('2026-01-01T00:10:00Z'),
        resolvedAt: new Date('2026-01-01T01:00:00Z'),
      },
    ]);
    expect(result).toMatchObject({
      active: 1,
      unassigned: 1,
      resolved: 1,
      total: 2,
      firstResponseMinutes: 10,
      resolutionMinutes: 60,
      byPriority: { HIGH: 1 },
    });
    expect(metrics([]).resolutionMinutes).toBeNull();
  });
});
