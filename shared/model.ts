export const roles = ['EMPLOYEE', 'ENGINEER', 'ADMIN'] as const;
export const statuses = ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED'] as const;
export const priorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export const ticketTypes = ['INCIDENT', 'REQUEST', 'PROBLEM', 'CHANGE'] as const;
export const impacts = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type TicketType = (typeof ticketTypes)[number];
export type Impact = (typeof impacts)[number];
/**
 * The ITSM priority matrix. Impact is how many people or services are affected; urgency is how
 * quickly it must be fixed. The result is a starting point that staff may still override.
 */
export function priorityFor(impact: Impact, urgency: Impact): (typeof priorities)[number] {
  const score = { LOW: 0, MEDIUM: 1, HIGH: 2 }[impact] + { LOW: 0, MEDIUM: 1, HIGH: 2 }[urgency];
  if (impact === 'HIGH' && urgency === 'HIGH') return 'URGENT';
  if (score >= 3) return 'HIGH';
  if (score === 2) return 'MEDIUM';
  return 'LOW';
}
export type Role = (typeof roles)[number];
export type Status = (typeof statuses)[number];
export const labels: Record<string, string> = {
  EMPLOYEE: 'Employee',
  ENGINEER: 'IT Engineer',
  ADMIN: 'Administrator',
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  WAITING_FOR_USER: 'Waiting for User',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
  INCIDENT: 'Incident',
  REQUEST: 'Service request',
  PROBLEM: 'Problem',
  CHANGE: 'Change',
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  // Asset vocabulary: the recorded state of a device, in the words an engineer would use.
  IN_USE: 'In use',
  AVAILABLE: 'In stock',
  REPAIR: 'In repair',
  RETIRED: 'Retired',
  LAPTOP: 'Laptop',
  DESKTOP: 'Desktop',
  ACCESS_POINT: 'Access point',
  PRINTER: 'Printer',
  SWITCH: 'Switch',
};
export const transitions: Record<Status, Status[]> = {
  OPEN: ['IN_PROGRESS'],
  IN_PROGRESS: ['WAITING_FOR_USER', 'RESOLVED'],
  WAITING_FOR_USER: ['IN_PROGRESS', 'RESOLVED'],
  RESOLVED: ['CLOSED', 'OPEN'],
  CLOSED: ['OPEN'],
};
export interface Person {
  id: string;
  name: string;
  role: Role;
}
export interface CurrentUser extends Person {
  email: string;
}
export interface Ticket {
  id: string;
  number: number;
  title: string;
  description: string;
  status: Status;
  priority: (typeof priorities)[number];
  categoryId: string;
  category: { id: string; name: string };
  requester: Person;
  requesterId: string;
  assignee: Person | null;
  assigneeId: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  version: number;
  assetId: string | null;
  asset: {id:string;tag:string;model:string;ownerId:string|null} | null;
  replies?: Reply[];
  sla?: SlaView | null;
  // Workspace (Phase 6)
  type: TicketType;
  impact: Impact;
  urgency: Impact;
  labels: string[];
  rank: number;
  dueAt: string | null;
  closedAt: string | null;
  catalogItemId: string | null;
  catalogItem?: { id: string; name: string; icon: string } | null;
  formData?: Record<string, unknown> | null;
  watchers?: Person[];
  watching?: boolean;
  approvals?: Approval[];
  attachments?: Attachment[];
  survey?: { score: number; comment: string | null; createdAt: string } | null;
  requesterProfile?: Profile | null;
}
export interface Reply {
  id: string;
  body: string;
  author: Person;
  createdAt: string;
  editedAt?: string | null;
  mentions?: Person[];
  attachments?: Attachment[];
}
export interface Attachment {
  id: string;
  filename: string;
  mime: string;
  size: number;
  createdAt: string;
  uploader: Person;
  replyId?: string | null;
}
export interface Approval {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  approver: Person;
  note: string | null;
  decidedAt: string | null;
  createdAt: string;
}
export interface FormField {
  key: string;
  label: string;
  kind: 'text' | 'textarea' | 'select' | 'number' | 'date' | 'checkbox';
  required?: boolean;
  options?: string[];
  placeholder?: string;
  help?: string;
}
export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  type: TicketType;
  categoryId: string;
  category?: { id: string; name: string };
  priority: (typeof priorities)[number];
  fields: FormField[];
  requiresApproval: boolean;
  approverKind: 'MANAGER' | 'ADMIN' | 'DEPARTMENT_MANAGER';
  approverDepartmentId: string | null;
  active: boolean;
  sortOrder: number;
}
export interface TicketTemplate {
  id: string;
  name: string;
  title: string;
  description: string;
  categoryId: string;
  priority: (typeof priorities)[number];
  type: TicketType;
  active: boolean;
}
export interface SavedView {
  id: string;
  name: string;
  filters: Record<string, string>;
  shared: boolean;
  userId: string;
  owner?: Person;
}
export interface Department {
  id: string;
  name: string;
  code: string;
  costCentre: string | null;
  managerId: string | null;
  manager: Person | null;
  parentId: string | null;
  memberCount?: number;
}
export interface Profile extends Person {
  email: string;
  title: string | null;
  location: string | null;
  phone: string | null;
  department: { id: string; name: string; code: string; costCentre?: string | null } | null;
  manager: Person | null;
  active?: boolean;
  createdAt?: string;
  reports?: Person[];
}
export interface Announcement {
  id: string;
  title: string;
  body: string;
  audience: 'ALL' | 'STAFF';
  pinned: boolean;
  publishedAt: string;
  expiresAt: string | null;
  author: Person;
}
export interface ActivityItem {
  id: string;
  kind: 'event' | 'reply' | 'note' | 'attachment' | 'approval';
  at: string;
  actor: Person | null;
  title: string;
  body?: string;
  internal: boolean;
}
export interface SearchResults {
  tickets: { id: string; number: number; title: string; status: Status; type?: string; catalogItemId?: string | null }[];
  assets: { id: string; tag: string; model: string; type?: string; status?: string; owner?: Person | null }[];
  articles: { id: string; title: string; visibility?: string; updatedAt?: string; category?: { id: string; name: string } }[];
  people: (Person & { title?: string | null; department?: { id: string; name: string } | null })[];
  departments?: { id: string; name: string; code: string; memberCount: number }[];
  services?: { id: string; name: string; description: string; icon: string; requiresApproval: boolean }[];
}
/** Votes on an article, plus the caller's own. `mine` is null when they have not voted. */
export interface ArticleFeedback {
  helpful: number;
  notHelpful: number;
  mine: boolean | null;
}
export interface KnowledgeOverview {
  total: number;
  categories: { id: string; name: string; articles: number }[];
  recent: ArticleSummary[];
  helpful: (ArticleSummary & { helpfulVotes: number })[];
}
export interface Asset {
  id: string;
  tag: string;
  type: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  ownerId: string | null;
  owner: (Person & { title?: string | null; email?: string; location?: string | null; department?: { id: string; name: string; code: string } | null }) | null;
  status: string;
  purchaseDate: string | null;
  warrantyExpiry: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  tickets?: { id: string; number: number; title: string; status: string; type?: string; priority?: string; createdAt: string; resolvedAt?: string | null; requester?: Person }[];
}
export interface AssetSummary extends AssetMetrics {
  assigned: number;
  retired: number;
  attention: number;
}
export interface NotifyPrefs {
  assignment: boolean;
  reply: boolean;
  mention: boolean;
  watched: boolean;
  sla: boolean;
  approval: boolean;
  survey: boolean;
}
export interface BoardColumn {
  status: Status;
  tickets: Ticket[];
  total: number;
}
export interface Reports {
  windowDays: number;
  csat: { responses: number; average: number | null; distribution: Record<string, number> };
  agents: { id: string; name: string; resolved: number; open: number; averageResolutionMinutes: number | null; csat: number | null }[];
  departments: { id: string; name: string; code: string; costCentre: string | null; tickets: number; open: number }[];
  byType: Record<string, number>;
  createdPerDay: { day: string; created: number; resolved: number }[];
}
/** Serialized `slaView()` output. Dates arrive as ISO strings over HTTP. */
export interface SlaView {
  id: string;
  ticketId: string;
  priority: (typeof priorities)[number];
  responseMinutes: number;
  resolutionMinutes: number;
  startedAt: string;
  responseDueAt: string;
  responseSatisfiedAt: string | null;
  responseBreachAt: string | null;
  resolutionBreachAt: string | null;
  resolutionDueAt: string | null;
  remainingResponseMs: number;
  remainingResolutionMs: number;
  elapsedMs: number;
  runningSince: string | null;
  legacyBackfill: boolean;
  paused: boolean;
  stopped: boolean;
  asOf: string;
}
export interface TicketEvent {
  id: string;
  ticketId: string | null;
  action: string;
  detail: string;
  internal: boolean;
  createdAt: string;
  actor: Person | null;
}
export interface Note {
  id: string;
  body: string;
  author: Person;
  createdAt: string;
}
export const articleVisibilities = ['EMPLOYEE', 'SUPPORT'] as const;
export const articleStatuses = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export interface ArticleSummary {
  id: string;
  title: string;
  visibility: (typeof articleVisibilities)[number];
  status: (typeof articleStatuses)[number];
  category: { id: string; name: string };
  updatedAt: string;
  version: number;
}
export interface Article extends ArticleSummary {
  markdown: string;
  categoryId: string;
  html: string;
  feedback?: ArticleFeedback;
  author: Person | null;
  publishedAt: string | null;
  archivedAt: string | null;
}
export interface SlaPolicy {
  priority: (typeof priorities)[number];
  responseMinutes: number;
  resolutionMinutes: number;
  updatedAt: string;
}
export interface Notification {
  id: string;
  kind: string;
  createdAt: string;
  ticketId: string;
  ticket: { number: number; title?: string };
  text: string;
  readAt?: string | null;
}
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface Metrics {
  active: number;
  unassigned: number;
  resolved: number;
  total: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byCategory: Record<string, number>;
  workload: Record<string, number>;
  firstResponseMinutes: number | null;
  resolutionMinutes: number | null;
  sla: SlaMetrics;
  assets: AssetMetrics | null;
}
/**
 * Denominators are explicit so a reader can reproduce every number from stored rows.
 * `responseMeasured` counts tickets whose SLA record already has a first public engineer
 * response; `resolutionMeasured` counts tickets that reached Resolved or Closed.
 */
export interface SlaMetrics {
  tracked: number;
  responseMeasured: number;
  responseBreached: number;
  responseCompliancePercent: number | null;
  resolutionMeasured: number;
  resolutionBreached: number;
  resolutionCompliancePercent: number | null;
  activeBreached: number;
  activeAtRisk: number;
  breachedTickets: { id: string; number: number; title: string; kind: 'RESPONSE' | 'RESOLUTION' }[];
}
export interface AssetMetrics {
  total: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  unassigned: number;
  warrantyExpiring90Days: number;
}

/* ---------- Phase 3: AI assistance and knowledge retrieval ---------- */

export type AiMode = 'disabled' | 'mock' | 'openai';
export interface AiStatus {
  mode: AiMode;
  enabled: boolean;
  mock: boolean;
  chatModel: string | null;
  embeddingModel: string | null;
  dimensions: number | null;
  dailyLimit: number;
  usedToday: number;
  timeoutMs: number;
}
export interface TriageResult {
  summary: string;
  suggestedCategory: string;
  suggestedCategoryId: string | null;
  suggestedCategoryMatched: boolean;
  suggestedPriority: (typeof priorities)[number];
  reasons: string[];
  missingInformation: string[];
  troubleshootingSteps: string[];
  ticketVersion: number;
  fingerprint: string;
  mock: boolean;
  model: string;
  reviewNote: string;
}
export interface SummaryResult {
  summary: string;
  openQuestions: string[];
  nextAction: string;
  internalOnly: boolean;
  mock: boolean;
  model: string;
}
export interface DraftResult {
  draft: string;
  toneNote: string;
  mock: boolean;
  model: string;
  sourceScope: 'public';
  reviewNote: string;
}
export interface Citation {
  number: number;
  articleId: string;
  articleTitle: string;
  heading: string | null;
  excerpt: string;
  chunkIndex: number;
}
export interface AnswerResult {
  sufficientEvidence: boolean;
  answer: string;
  escalationAdvice: string;
  citations: Citation[];
  mock: boolean;
  model: string;
  retrieved: number;
  disclaimer: string;
}
export type IndexState = 'NOT_INDEXED' | 'INDEXED' | 'STALE_CONTENT' | 'STALE_MODEL' | 'NOT_ELIGIBLE' | 'FAILED';
export interface IndexItem {
  id: string;
  title: string;
  status: string;
  visibility: string;
  version: number;
  indexedVersion: number | null;
  indexedModel: string | null;
  indexedAt: string | null;
  indexError: string | null;
  chunks: number;
  state: IndexState;
}
export interface IndexOverview {
  mode: AiMode;
  embeddingModel: string | null;
  dimensions: number | null;
  chatModel: string | null;
  pgvector: boolean;
  items: IndexItem[];
  chunkTotals: { model: string; dimensions: number; chunks: number }[];
}
export interface AiUsageOverview {
  windowDays: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  averageDurationMs: number;
  byOperation: { operation: string; calls: number; inputTokens: number; outputTokens: number }[];
  byOutcome: { outcome: string; calls: number }[];
  costNote: string;
}

/* ---------- Operations command center ---------- */

/** `GET /operations/summary`: every figure counted from stored rows for the chosen window. */
export interface OperationsSummary {
  generatedAt: string;
  window: { days: number; from: string; to: string; departmentId: string | null };
  active: {
    total: number;
    unassigned: number;
    unassignedByPriority: Record<string, number>;
    oldestUnassignedAgeMs: number | null;
    byPriority: Record<string, number>;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
    withAsset: number;
  };
  sla: SlaMetrics & { atRisk: number; atRiskUnder30Min: number; oldestBreachAgeMs: number | null };
  flow: {
    created: number; resolved: number; previousCreated: number; previousResolved: number;
    perDay: { day: string; created: number; resolved: number }[];
    backlogChange: number; resolutionRatePercent: number | null;
  };
  mttrMinutes: number | null;
  previousMttrMinutes: number | null;
  csat: { responses: number; average: number | null; previousAverage: number | null };
  approvals: { pending: number; oldestPendingAgeMs: number | null };
  departments: { id: string; name: string; code: string; active: number; unassigned: number; atRisk: number; breached: number; created: number }[];
  unplaced: { active: number; unassigned: number };
  categories: { id: string; name: string; active: number; unassigned: number; atRisk: number; breached: number }[];
  engineers: { id: string; name: string; active: number; atRisk: number; breached: number; urgent: number }[];
  critical: {
    id: string; number: number; title: string; type: TicketType; priority: (typeof priorities)[number]; status: Status;
    category: string; assignee: Person | null; createdAt: string; ageMs: number; sla: SlaView | null;
    position: { breached: boolean; atRisk: boolean; remainingMs: number | null };
  }[];
  activity: { id: string; at: string; action: string; detail: string; actor: Person | null; ticket: { id: string; number: number; title: string; status: string; priority: string } | null }[];
  assets: AssetMetrics & { linkedToActiveTickets: number };
}

/* ── Service Intelligence (Phase 5) ────────────────────────────────────── */
export interface Comparison { value: number | null; previous: number | null; delta: number | null; measured: number }
export interface Analytics {
  generatedAt: string;
  window: { days: number; from: string; to: string; previousFrom: string; departmentId: string | null; type: string | null; priority: string | null };
  headline: { slaCompliance: Comparison; mttrMinutes: Comparison; csat: Comparison; resolutionRate: Comparison; backlog: Comparison; firstResponseMinutes: Comparison };
  series: { day: string; created: number; resolved: number; backlog: number; slaPercent: number | null; slaMeasured: number; csat: number | null; csatResponses: number; mttrMinutes: number | null; breaches: number }[];
  demand: {
    byDepartment: { id: string | null; name: string; created: number; byType: Record<string, number> }[];
    byType: Record<string, number>;
    byPriority: Record<string, number>;
    byCategory: { id: string; name: string; created: number }[];
    byService: { id: string; name: string; created: number }[];
    heat: { id: string; name: string; cells: Record<string, number> }[];
  };
  sla: {
    resolutionCompliancePercent: number | null; resolutionMeasured: number; responseCompliancePercent: number | null; responseMeasured: number;
    breaches: number; responseBreaches: number; resolutionBreaches: number; activeBreached: number; activeAtRisk: number;
    byDepartment: { id: string; name: string; breaches: number; measured: number; compliancePercent: number | null; activeAtRisk: number }[];
    byPriority: { priority: string; breaches: number; measured: number; compliancePercent: number | null; activeAtRisk: number }[];
    recentBreaches: { id: string; number: number; title: string; priority: string; status: string; department: string | null; kind: 'RESPONSE' | 'RESOLUTION'; breachedAt: string }[];
  };
  resolution: {
    mttrMinutes: number | null; previousMttrMinutes: number | null; resolvedInWindow: number; backlog: number; previousBacklog: number;
    ageDistribution: { label: string; count: number }[];
    oldestOpen: { id: string; number: number; title: string; priority: string; status: string; assignee: Person | null; ageMs: number; department: string | null }[];
    byPriority: { priority: string; resolved: number; mttrMinutes: number | null }[];
  };
  csat: { average: number | null; previousAverage: number | null; responses: number; previousResponses: number; distribution: Record<string, number>; byDepartment: { id: string; name: string; responses: number; average: number | null }[]; lowRated: number };
  team: { id: string; name: string; assigned: number; atRisk: number; breached: number; resolved: number; slaCompliancePercent: number | null; slaMeasured: number; mttrMinutes: number | null; csat: number | null; csatResponses: number }[];
}
export type ReportKind = 'tickets' | 'sla' | 'resolution' | 'csat' | 'requests' | 'departments' | 'agents' | 'assets';
export interface Report {
  kind: ReportKind;
  title: string;
  description: string;
  generatedAt: string;
  filters: { days: number; departmentId: string | null; type: string | null; priority: string | null };
  summary: { label: string; value: string }[];
  columns: { key: string; label: string; kind?: 'text' | 'number' | 'date' | 'key' }[];
  rows: Record<string, string | number | null>[];
  /** Every matching row, even when `rows` is capped for the screen. */
  total: number;
  /** True when `rows` holds only the first rows of a larger result; the CSV export is never capped. */
  truncated: boolean;
}

/** Asset enumerations, shared by the API schemas and the interface's selects. */
export const assetTypes = ['LAPTOP', 'DESKTOP', 'ACCESS_POINT', 'PRINTER', 'SWITCH'] as const;
export const assetStatuses = ['IN_USE', 'AVAILABLE', 'REPAIR', 'RETIRED'] as const;
