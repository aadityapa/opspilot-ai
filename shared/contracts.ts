import { z } from 'zod';
import { roles, statuses, priorities, ticketTypes, impacts } from './model.js';
export * from './model.js';
export const loginSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(1).max(128),
  })
  .strict();
export const labelSchema = z.string().trim().min(1).max(30).regex(/^[\p{L}\p{N} _./-]+$/u, 'Letters, numbers, spaces and - _ . / only').transform((v) => v.toLowerCase());
export const ticketSchema = z
  .object({
    title: z.string().trim().min(5).max(160),
    description: z.string().trim().min(10).max(10000),
    categoryId: z.uuid(),
    assetId: z.uuid().nullable().optional(),
    priority: z.enum(priorities).optional(),
    type: z.enum(ticketTypes).default('INCIDENT'),
    impact: z.enum(impacts).default('MEDIUM'),
    urgency: z.enum(impacts).default('MEDIUM'),
    labels: z.array(labelSchema).max(10).default([]),
    dueAt: z.iso.datetime().nullable().optional(),
    catalogItemId: z.uuid().nullable().optional(),
    formData: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    templateId: z.uuid().nullable().optional(),
  })
  .strict();
export const updateSchema = z
  .object({
    version: z.number().int().nonnegative(),
    status: z.enum(statuses).optional(),
    priority: z.enum(priorities).optional(),
    categoryId: z.uuid().optional(),
    assigneeId: z.uuid().nullable().optional(),
    assetId: z.uuid().nullable().optional(),
    type: z.enum(ticketTypes).optional(),
    impact: z.enum(impacts).optional(),
    urgency: z.enum(impacts).optional(),
    labels: z.array(labelSchema).max(10).optional(),
    dueAt: z.iso.datetime().nullable().optional(),
    title: z.string().trim().min(5).max(160).optional(),
  })
  .strict();
export const bulkSchema = z
  .object({
    ids: z.array(z.uuid()).min(1).max(100),
    status: z.enum(statuses).optional(),
    priority: z.enum(priorities).optional(),
    assigneeId: z.uuid().nullable().optional(),
    categoryId: z.uuid().optional(),
    addLabels: z.array(labelSchema).max(10).optional(),
    removeLabels: z.array(labelSchema).max(10).optional(),
  })
  .strict();
export const savedViewSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    filters: z.record(z.string().max(40), z.string().max(160)),
    shared: z.boolean().default(false),
  })
  .strict();
export const formFieldSchema = z
  .object({
    key: z.string().trim().min(1).max(40).regex(/^[a-z][a-z0-9_]*$/, 'lowercase letters, digits and _'),
    label: z.string().trim().min(1).max(80),
    kind: z.enum(['text', 'textarea', 'select', 'number', 'date', 'checkbox']),
    required: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
    placeholder: z.string().max(120).optional(),
    help: z.string().max(200).optional(),
  })
  .strict();
export const catalogItemSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().min(5).max(500),
    icon: z.string().trim().min(1).max(30).default('box'),
    type: z.enum(ticketTypes).default('REQUEST'),
    categoryId: z.uuid(),
    priority: z.enum(priorities).default('MEDIUM'),
    fields: z.array(formFieldSchema).max(20).default([]),
    requiresApproval: z.boolean().default(false),
    approverKind: z.enum(['MANAGER', 'ADMIN', 'DEPARTMENT_MANAGER']).default('MANAGER'),
    approverDepartmentId: z.uuid().nullable().optional(),
    active: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(1000).default(0),
  })
  .strict()
  .refine((v) => new Set(v.fields.map((f) => f.key)).size === v.fields.length, { message: 'Field keys must be unique', path: ['fields'] })
  .refine((v) => v.fields.every((f) => f.kind !== 'select' || (f.options && f.options.length > 0)), { message: 'A select field needs options', path: ['fields'] });
export const templateSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    title: z.string().trim().min(5).max(160),
    description: z.string().trim().min(10).max(10000),
    categoryId: z.uuid(),
    priority: z.enum(priorities).default('MEDIUM'),
    type: z.enum(ticketTypes).default('INCIDENT'),
    active: z.boolean().default(true),
  })
  .strict();
export const departmentSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    code: z.string().trim().min(2).max(12).transform((v) => v.toUpperCase()).refine((v) => /^[A-Z0-9-]+$/.test(v), 'Letters, digits and - only'),
    costCentre: z.string().trim().max(40).nullable().optional(),
    managerId: z.uuid().nullable().optional(),
    parentId: z.uuid().nullable().optional(),
  })
  .strict();
export const profileSchema = z
  .object({
    title: z.string().trim().max(80).nullable().optional(),
    location: z.string().trim().max(80).nullable().optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    departmentId: z.uuid().nullable().optional(),
    managerId: z.uuid().nullable().optional(),
  })
  .strict();
export const announcementSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    body: z.string().trim().min(3).max(4000),
    audience: z.enum(['ALL', 'STAFF']).default('ALL'),
    pinned: z.boolean().default(false),
    expiresAt: z.iso.datetime().nullable().optional(),
  })
  .strict();
export const surveySchema = z.object({ score: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional() }).strict();
export const approvalDecisionSchema = z.object({ decision: z.enum(['APPROVED', 'REJECTED']), note: z.string().trim().max(500).optional() }).strict();
export const notifyPrefsSchema = z
  .object({ assignment: z.boolean(), reply: z.boolean(), mention: z.boolean(), watched: z.boolean(), sla: z.boolean(), approval: z.boolean(), survey: z.boolean() })
  .strict();
export const replySchema = z.object({ body: z.string().trim().min(1).max(10000) }).strict();
export const listSchema = z.object({
  q: z.string().max(160).default(''),
  status: z.enum(statuses).optional(),
  priority: z.enum(priorities).optional(),
  categoryId: z.uuid().optional(),
  assigned: z.enum(['mine', 'unassigned']).optional(),
  assigneeId: z.uuid().optional(),
  sla: z.enum(['at-risk', 'breached', 'healthy']).optional(),
  open: z.enum(['true']).optional(),
  type: z.enum(ticketTypes).optional(),
  label: z.string().trim().max(30).optional(),
  watching: z.enum(['true']).optional(),
  requesterId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(15),
  sort: z.enum(['newest', 'oldest', 'updated']).default('newest'),
});
export const userSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    name: z.string().trim().min(2).max(100),
    role: z.enum(roles),
    // Length is the floor; the server also applies the full policy in server/security.ts.
    password: z.string().min(12).max(128),
  })
  .strict();
