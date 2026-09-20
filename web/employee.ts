import type { Ticket } from '../shared/model';

/**
 * Employee-facing language for tickets. Engineers see statuses, SLAs and assignments; a requester
 * sees where their request is, who needs to act and what happens next. Everything here is derived
 * from stored fields (status, assignee, approvals, resolvedAt) — nothing is estimated.
 */

export type RequestStage = 'submitted' | 'approval' | 'fulfilment' | 'waiting' | 'done';

export const isRequest = (t: Pick<Ticket, 'type' | 'catalogItemId'>) => t.type === 'REQUEST' || !!t.catalogItemId;

/** Short employee status word. */
export function requestStatus(t: Pick<Ticket, 'status' | 'assigneeId' | 'approvals'>): { word: string; tone: 'ok' | 'warn' | 'info' | 'neutral' | 'crit' } {
  const pending = t.approvals?.some((a) => a.status === 'PENDING');
  const rejected = t.approvals?.some((a) => a.status === 'REJECTED');
  if (rejected && ['RESOLVED', 'CLOSED'].includes(t.status)) return { word: 'Not approved', tone: 'crit' };
  if (t.status === 'RESOLVED') return { word: 'Completed', tone: 'ok' };
  if (t.status === 'CLOSED') return { word: 'Closed', tone: 'neutral' };
  if (pending) return { word: 'Awaiting approval', tone: 'warn' };
  if (t.status === 'WAITING_FOR_USER') return { word: 'Waiting for you', tone: 'warn' };
  if (t.status === 'IN_PROGRESS') return { word: 'In progress', tone: 'info' };
  return { word: t.assigneeId ? 'In progress' : 'Submitted', tone: 'info' };
}

/** What happens next, in plain words. */
export function nextStep(t: Pick<Ticket, 'status' | 'assigneeId' | 'approvals' | 'assignee'>): string {
  const pending = t.approvals?.find((a) => a.status === 'PENDING');
  if (pending) return `${pending.approver.name} reviews your request`;
  if (t.approvals?.some((a) => a.status === 'REJECTED') && ['RESOLVED', 'CLOSED'].includes(t.status)) return 'Nothing further — the request was declined';
  if (t.status === 'RESOLVED') return 'Done — you can rate the outcome or reopen it';
  if (t.status === 'CLOSED') return 'Closed';
  if (t.status === 'WAITING_FOR_USER') return 'IT is waiting for your reply';
  if (t.status === 'IN_PROGRESS') return `${t.assignee ? t.assignee.name : 'IT'} is working on it`;
  return t.assigneeId ? `${t.assignee?.name ?? 'IT'} picks it up next` : 'IT picks it up next';
}

/** Progress steps derived from real workflow state. Approval only appears when the request has one. */
export function progressSteps(t: Pick<Ticket, 'status' | 'assigneeId' | 'approvals' | 'resolvedAt'>): { key: RequestStage; label: string; state: 'done' | 'current' | 'todo' | 'failed' }[] {
  const hasApproval = !!t.approvals?.length;
  const pending = t.approvals?.some((a) => a.status === 'PENDING');
  const rejected = t.approvals?.some((a) => a.status === 'REJECTED');
  const finished = ['RESOLVED', 'CLOSED'].includes(t.status);
  const working = t.status === 'IN_PROGRESS' || t.status === 'WAITING_FOR_USER' || (t.status === 'OPEN' && !!t.assigneeId);
  const steps: ReturnType<typeof progressSteps> = [{ key: 'submitted', label: 'Submitted', state: 'done' }];
  if (hasApproval) steps.push({ key: 'approval', label: 'Approval', state: rejected ? 'failed' : pending ? 'current' : 'done' });
  if (rejected) return steps;
  steps.push({ key: 'fulfilment', label: 'IT fulfilment', state: finished ? 'done' : pending ? 'todo' : working ? 'current' : 'current' });
  steps.push({ key: 'done', label: 'Completed', state: finished ? 'done' : 'todo' });
  return steps;
}

export const APPROVER_WORD: Record<string, string> = { MANAGER: 'Manager approval', ADMIN: 'Administrator approval', DEPARTMENT_MANAGER: 'Department manager approval' };
