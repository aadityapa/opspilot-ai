import { labels, type SlaView } from '../../shared/model';
import { Icon } from './icons';

/**
 * Restrained operational marks used by the Service Desk, the board and the ticket workspace:
 * a dot plus text for priority and status, and the OpsPilot SLA signature. Never colour alone.
 */

export const PRIORITY_CODE: Record<string, string> = { URGENT: 'P1', HIGH: 'P2', MEDIUM: 'P3', LOW: 'P4' };
export const PRIORITY_WORD: Record<string, string> = { URGENT: 'Critical', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
const PRIORITY_VAR: Record<string, string> = { URGENT: 'p1', HIGH: 'p2', MEDIUM: 'p3', LOW: 'p4' };
export const STATUS_WORD: Record<string, string> = { OPEN: 'Open', IN_PROGRESS: 'In Progress', WAITING_FOR_USER: 'Pending user', RESOLVED: 'Resolved', CLOSED: 'Closed' };
const STATUS_VAR: Record<string, string> = { OPEN: 'st-open', IN_PROGRESS: 'st-progress', WAITING_FOR_USER: 'st-waiting', RESOLVED: 'st-resolved', CLOSED: 'st-closed' };

export function PriorityMark({ value, short }: { value: string; short?: boolean }) {
  return <span className={`mark priority-${PRIORITY_VAR[value] ?? 'p4'}`} title={labels[value]}><i style={{ background: `var(--${PRIORITY_VAR[value] ?? 'p4'})` }} />{PRIORITY_CODE[value] ?? value}{!short && <em> {PRIORITY_WORD[value] ?? ''}</em>}</span>;
}

export function StatusMark({ value }: { value: string }) {
  return <span className="mark status-mark"><i style={{ background: `var(--${STATUS_VAR[value] ?? 'st-closed'})` }} />{STATUS_WORD[value] ?? labels[value] ?? value}</span>;
}

export type SlaTone = 'ok' | 'warn' | 'risk' | 'breach' | 'met' | 'paused' | 'none';

/** One evaluation of an SLA view, shared by every mark and panel on the client. */
export function slaSummary(sla: SlaView | null | undefined, status: string, asOf = Date.now()): { tone: SlaTone; text: string; detail: string; ratio: number | null } {
  if (!sla) return { tone: 'none', text: 'No SLA', detail: 'No policy applied', ratio: null };
  const done = ['RESOLVED', 'CLOSED'].includes(status);
  const breachAt = sla.responseBreachAt ?? sla.resolutionBreachAt;
  if (done) return breachAt ? { tone: 'breach', text: 'Breached', detail: 'Finished after the deadline', ratio: null } : { tone: 'met', text: 'Met', detail: 'Finished within target', ratio: null };
  if (breachAt) {
    const age = Math.max(0, asOf - new Date(breachAt).getTime());
    return { tone: 'breach', text: `Breached · ${age >= 3600000 ? `${Math.floor(age / 3600000)}h ${String(Math.floor((age % 3600000) / 60000)).padStart(2, '0')}m` : `${Math.floor(age / 60000)}m`}`, detail: sla.responseBreachAt ? 'First response missed' : 'Resolution deadline missed', ratio: 0 };
  }
  if (sla.paused) return { tone: 'paused', text: 'Paused', detail: 'Waiting for the requester', ratio: null };
  const remaining = sla.responseSatisfiedAt ? sla.remainingResolutionMs : sla.remainingResponseMs;
  const budget = (sla.responseSatisfiedAt ? sla.resolutionMinutes : sla.responseMinutes) * 60000;
  const ratio = budget ? Math.max(0, Math.min(1, remaining / budget)) : 1;
  const total = Math.max(0, Math.floor(remaining / 60000));
  const h = Math.floor(total / 60), m = total % 60;
  const text = `${h >= 100 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`} left`;
  const which = sla.responseSatisfiedAt ? 'resolution' : 'first response';
  if (ratio <= 0.1) return { tone: 'risk', text, detail: `Critical: ${which} deadline imminent`, ratio };
  if (ratio <= 0.25) return { tone: 'warn', text, detail: `At risk: under 25% of the ${which} budget left`, ratio };
  return { tone: 'ok', text, detail: `Healthy: ${which} on track`, ratio };
}

export function SlaMark({ sla, status, bar = true }: { sla: SlaView | null | undefined; status: string; bar?: boolean }) {
  const s = slaSummary(sla, status);
  const icon = s.tone === 'breach' ? 'alert' : s.tone === 'risk' ? 'zap' : s.tone === 'met' ? 'check' : s.tone === 'ok' ? 'check' : 'clock';
  return (
    <span className={`sla-mark ${s.tone}`} title={s.detail} aria-label={`SLA ${s.text}: ${s.detail}`}>
      <span className="sla-mark-text"><Icon name={icon} size={12} />{s.text}</span>
      {bar && s.ratio !== null && s.tone !== 'breach' && <span className="sla-mark-bar"><i style={{ width: `${Math.max(4, s.ratio * 100)}%` }} /></span>}
    </span>
  );
}
