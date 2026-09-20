import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { z, ZodError } from 'zod';
import { db } from './db.js';
import { config } from './config.js';
import { canReadTicket, canTransition, metrics } from './domain.js';
import {
  ticketSchema,
  updateSchema,
  replySchema,
  listSchema,
  type CurrentUser,
} from '../shared/contracts.js';
import { publicAuthRouter, authRouter, adminAuthRouter, sessionMiddleware } from './auth.js';
import { requestLogger, metricsRouter, healthRouter, logError } from './observability.js';
import { governanceRouter } from './governance.js';
import { workspaceRouter, createTicket, detailInclude, canAccess, findMentions, notifyWatchers } from './workspace.js';
import { peopleRouter } from './people.js';
import { operationsRouter } from './operations.js';
import { analyticsRouter } from './analytics.js';
import { reportsRouter } from './reports.js';
import { realtimeRouter, notifyUsers } from './realtime.js';
import { priorityFor } from '../shared/model.js';
import { Prisma } from '../generated/prisma/client.js';
import { HttpError, fail } from './http.js';
import { heavyReadLimit } from './limits.js';
import { assetRouter, assetMetrics, assetScope, checkAssetLink } from './assets.js';
import {notesRouter} from './notes.js';
import {slaRouter,systemClock,newSla,advanceSla,slaView,slaMetrics,slaPosition,type Clock} from './sla.js';
import {knowledgeRouter} from './knowledge.js';
import {enqueue,notificationRouter} from './notifications.js';
import {aiRouter} from './ai/routes.js';
import {AiError,provider as defaultProvider,type AiProvider} from './ai/provider.js';
declare global {
  namespace Express {
    interface Locals {
      user: CurrentUser;
      tokenHash: string;
      csrfToken: string;
    }
  }
}
const person = { id: true, name: true, role: true } as const;
const include = {
  sla:true,
  asset: { select: { id: true, tag: true, model: true, ownerId: true } },
  category: true,
  requester: { select: person },
  assignee: { select: person },
  catalogItem: { select: { id: true, name: true, icon: true } },
} as const;
const idOf = (req: Request) => z.uuid().parse(req.params.id);
function visibleTicket<T extends {assetId:string|null;asset:{ownerId:string|null}|null}>(ticket:T,user:CurrentUser){
  if(user.role==='EMPLOYEE'&&ticket.asset?.ownerId!==user.id)return {...ticket,assetId:null,asset:null};
  return ticket;
}
/** Prisma's connection-level failures and the driver's socket errors, as opposed to a bad query. */
function databaseUnavailable(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError) return ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(err.code);
  const e = err as { code?: string; message?: string };
  return ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(e?.code ?? '') || /connection (terminated|refused|closed)|Can't reach database server|database server .* is (not|un)reachable/i.test(e?.message ?? '');
}

export function createApp(clock:Clock=systemClock,ai:AiProvider=defaultProvider) {
  const app = express();
  app.disable('x-powered-by');
  // Behind the production reverse proxy the client address arrives in X-Forwarded-For. Trusting
  // exactly one hop means the proxy's own address is never mistaken for a client's.
  if (config.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use(requestLogger);
  app.use(helmet());
  app.use(cors({ origin: config.APP_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // All mutations, including login, require an exact Origin. Non-browser clients must send it too.
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') !== config.APP_ORIGIN)
      return next(new HttpError(403, 'Request origin rejected'));
    next();
  });
  app.use('/api', healthRouter);
  app.use(metricsRouter);
  app.use('/api', publicAuthRouter);
  app.use('/api', sessionMiddleware);
  const staff = (_req: Request, res: Response, next: NextFunction) =>
    res.locals.user.role === 'EMPLOYEE'
      ? next(new HttpError(403, 'Support role required'))
      : next();
  app.use('/api', authRouter);
  app.use('/api', adminAuthRouter);
  app.use('/api', governanceRouter);
  app.use('/api', workspaceRouter);
  app.use('/api', peopleRouter);
  app.use('/api', operationsRouter(clock));
  app.use('/api', analyticsRouter(clock));
  app.use('/api', reportsRouter(clock));
  app.use('/api', realtimeRouter);
  app.use('/api', assetRouter);
  app.use('/api', notesRouter);
  app.use('/api', slaRouter);
  app.use('/api', knowledgeRouter);
  app.use('/api', notificationRouter);
  app.use('/api', aiRouter(ai));
  app.get('/api/categories', async (_req, res) =>
    res.json(await db.category.findMany({ orderBy: { name: 'asc' } })),
  );
  app.get('/api/engineers', staff, async (_req, res) =>
    res.json(
      await db.user.findMany({
        where: { active: true, role: { in: ['ENGINEER', 'ADMIN'] } },
        select: person,
        orderBy: { name: 'asc' },
      }),
    ),
  );
  app.get('/api/tickets', async (req, res) => {
    const f = listSchema.parse(req.query);
    const user = res.locals.user;
    const where: Prisma.TicketWhereInput = {
      ...(user.role === 'EMPLOYEE' ? { requesterId: user.id } : {}),
      ...(f.status ? { status: f.status } : {}),
      ...(f.priority ? { priority: f.priority } : {}),
      ...(f.categoryId ? { categoryId: f.categoryId } : {}),
      ...(f.assigned ? { assigneeId: f.assigned === 'mine' ? user.id : null } : {}),
      ...(f.assigneeId ? { assigneeId: f.assigneeId } : {}),
      // An SLA position is computed, not stored, so filtering by it means evaluating the active rows.
      ...(f.sla || f.open ? { status: f.status ?? { in: ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER'] } } : {}),
      ...(f.type ? { type: f.type } : {}),
      ...(f.label ? { labels: { has: f.label.toLowerCase() } } : {}),
      ...(f.watching ? { watchers: { some: { userId: user.id } } } : {}),
      ...(f.requesterId && user.role !== 'EMPLOYEE' ? { requesterId: f.requesterId } : {}),
      ...(f.q
        ? {
            OR: [
              { title: { contains: f.q, mode: 'insensitive' } },
              { description: { contains: f.q, mode: 'insensitive' } },
              ...(/^\d+$/.test(f.q) && Number(f.q) < 2147483647 ? [{ number: Number(f.q) }] : []),
            ],
          }
        : {}),
    };
    const orderBy: Prisma.TicketOrderByWithRelationInput[] =
      f.sort === 'updated'
        ? [{ updatedAt: 'desc' }, { id: 'asc' }]
        : [{ createdAt: f.sort === 'oldest' ? 'asc' : 'desc' }, { id: 'asc' }];
    const now = clock.now();
    let total: number, items: Awaited<ReturnType<typeof db.ticket.findMany<{ include: typeof include }>>>;
    if (f.sla) {
      const rows = await db.ticket.findMany({ where, include, orderBy });
      const wanted = rows.filter((t) => {
        const p = slaPosition(t, now);
        return f.sla === 'breached' ? p.breached : f.sla === 'at-risk' ? p.atRisk : !!t.sla && !p.breached && !p.atRisk;
      });
      total = wanted.length;
      items = wanted.slice((f.page - 1) * f.pageSize, f.page * f.pageSize);
    } else {
      [total, items] = await db.$transaction(
        [db.ticket.count({ where }), db.ticket.findMany({ where, include, orderBy, skip: (f.page - 1) * f.pageSize, take: f.pageSize })],
        { isolationLevel: 'RepeatableRead' },
      );
    }
    res.json({ items: items.map(t=>({...visibleTicket(t,user),sla:t.sla?slaView(t.sla,now,t.status):null})), total, page: f.page, pageSize: f.pageSize });
  });
  app.post('/api/tickets', async (req, res) => {
    const ticket = await createTicket(res, req, clock);
    res.status(201).json({ ...visibleTicket(ticket, res.locals.user), watching: true });
  });
  app.get('/api/tickets/:id', async (req, res) => {
    const me = res.locals.user;
    const ticket = await db.ticket.findUnique({
      where: { id: idOf(req) },
      include: {
        ...detailInclude,
        replies: {
          where: { internal: false },
          include: { author: { select: person }, mentions: { select: person } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
        requester: { select: { ...person, email: true, title: true, location: true, phone: true, department: { select: { id: true, name: true, code: true } }, manager: { select: person } } },
      },
    });
    if (!ticket || !(await canAccess(db, me, ticket))) fail(404, 'Ticket not found');
    const { watchers, requester, ...rest } = ticket;
    const requesterProfile = me.role === 'EMPLOYEE' && me.id !== requester.id ? null : requester;
    res.json({
      ...visibleTicket(rest, me),
      requester: { id: requester.id, name: requester.name, role: requester.role },
      requesterProfile,
      watchers: watchers.map((w) => w.user),
      watching: watchers.some((w) => w.user.id === me.id),
      sla: ticket.sla ? slaView(ticket.sla, clock.now(), ticket.status) : null,
    });
  });
  app.post('/api/tickets/:id/replies', async (req, res) => {
    const data = replySchema.parse(req.body);
    const id = idOf(req);
    const user = res.locals.user;
    const reply = await db.$transaction(async (tx) => {
      // Serialize replies with status changes; evaluate authorization and state after acquiring the row lock.
      await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id = ${id} FOR UPDATE`;
      const ticket = await tx.ticket.findUnique({ where: { id } });
      if (!ticket || !(await canAccess(tx, user, ticket))) fail(404, 'Ticket not found');
      if (ticket.status === 'CLOSED' || ticket.status === 'RESOLVED')
        fail(409, 'Reopen this ticket before replying');
      const mentioned = await findMentions(tx, data.body, ticket);
      const reply = await tx.reply.create({
        data: { ticketId: id, authorId: user.id, body: data.body, createdAt: clock.now(), mentions: { connect: mentioned.map((m) => ({ id: m.id })) } },
        include: { author: { select: person }, mentions: { select: person } },
      });
      if (mentioned.length) await enqueue(tx, ticket, 'MENTION', `mention:${reply.id}`, clock.now(), user.id, mentioned.map((m) => m.id));
      await notifyWatchers(tx, ticket, `reply:${reply.id}`, user.id);
      await tx.ticket.update({
        where: { id },
        data: {
          version: { increment: 1 },
          ...(user.role !== 'EMPLOYEE' && user.id !== ticket.requesterId && !ticket.firstRespondedAt
            ? { firstRespondedAt: clock.now() }
            : {}),
          ...(user.role === 'EMPLOYEE' && ticket.status === 'WAITING_FOR_USER'
            ? { status: 'IN_PROGRESS' }
            : {}),
        },
      });
      await advanceSla(tx,id,user.role==='EMPLOYEE'&&ticket.status==='WAITING_FOR_USER'?'IN_PROGRESS':ticket.status,clock.now(),user.role!=='EMPLOYEE'&&user.id!==ticket.requesterId);
      await enqueue(tx,ticket,'PUBLIC_REPLY',`reply:${reply.id}`,clock.now(),user.id);
      await tx.event.create({
        data: {
          ticketId: id,
          actorId: user.id,
          action: 'PUBLIC_REPLY',
          detail:
            user.role === 'EMPLOYEE' && ticket.status === 'WAITING_FOR_USER'
              ? 'Public reply added; resumed In Progress'
              : 'Public reply added',
        },
      });
      return reply;
    });
    notifyUsers([reply.author.id], { type: 'ticket', ticketId: id });
    res.status(201).json(reply);
  });
  app.patch('/api/tickets/:id', staff, async (req, res) => {
    const data = updateSchema.parse(req.body);
    const id = idOf(req);
    const ticket = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id = ${id} FOR UPDATE`;
      const current = await tx.ticket.findUnique({ where: { id } });
      if (!current) fail(404, 'Ticket not found');
      if (current.version !== data.version) fail(409, 'Ticket changed. Refresh and try again.');
      if (
        data.status &&
        data.status !== current.status &&
        !canTransition(current.status, data.status)
      )
        fail(409, 'Status transition is not allowed');
      if (data.assigneeId) {
        const assignee = await tx.user.findFirst({
          where: { id: data.assigneeId, active: true, role: { in: ['ENGINEER', 'ADMIN'] } },
        });
        if (!assignee) fail(400, 'Assignee must be an active engineer or administrator');
      }
      if (data.categoryId && !(await tx.category.findUnique({ where: { id: data.categoryId } })))
        fail(400, 'Unknown category');
      await checkAssetLink(tx,res.locals.user,data.assetId,current.requesterId);
      const { version, dueAt, ...changes } = data;
      // Changing impact or urgency without naming a priority re-derives it from the matrix.
      const matrixChanged = (data.impact && data.impact !== current.impact) || (data.urgency && data.urgency !== current.urgency);
      const derived = matrixChanged && !data.priority ? { priority: priorityFor(data.impact ?? current.impact, data.urgency ?? current.urgency) } : {};
      const result = await tx.ticket.update({
        where: { id },
        data: {
          ...changes,
          ...derived,
          ...(dueAt !== undefined ? { dueAt: dueAt ? new Date(dueAt) : null } : {}),
          version: { increment: 1 },
          ...(data.status === 'RESOLVED' && current.status !== 'RESOLVED'
            ? { resolvedAt: clock.now() }
            : {}),
          ...(data.status === 'CLOSED' && current.status !== 'CLOSED' ? { closedAt: clock.now() } : {}),
          ...(data.status === 'OPEN' ? { resolvedAt: null, closedAt: null } : {}),
        },
        include,
      });
      await advanceSla(tx,id,result.status,clock.now());
      if(!result.sla&&data.status==='OPEN')await tx.ticketSla.create({data:{ticketId:id,...await newSla(tx,result.priority,clock.now()),responseSatisfiedAt:result.firstRespondedAt,legacyBackfill:true}});
      const detail =
        Object.entries(changes)
          .filter(([k, v]) => current[k as keyof typeof current] !== v)
          .map(([k, v]) => `${k}: ${String(current[k as keyof typeof current])} → ${String(v)}`)
          .join('; ') || 'No field changes';
      await tx.event.create({
        data: { ticketId: id, actorId: res.locals.user.id, action: 'UPDATED', detail },
      });
      if(data.assigneeId&&data.assigneeId!==current.assigneeId)await enqueue(tx,result,'ASSIGNMENT',`assignment:${id}:${result.version}`,clock.now());
      if (data.assigneeId && data.assigneeId !== current.assigneeId) await tx.watcher.upsert({ where: { ticketId_userId: { ticketId: id, userId: data.assigneeId } }, create: { ticketId: id, userId: data.assigneeId }, update: {} });
      if (data.status && data.status !== current.status) await notifyWatchers(tx, result, `status:${id}:${result.version}`, res.locals.user.id);
      if (data.status === 'RESOLVED' && current.status !== 'RESOLVED') await enqueue(tx, result, 'SURVEY_REQUEST', `survey:${id}`, clock.now(), res.locals.user.id, [result.requesterId]);
      return result;
    });
    const current=await db.ticket.findUniqueOrThrow({where:{id},include});
    notifyUsers([current.requesterId, ...(current.assigneeId ? [current.assigneeId] : [])], { type: 'ticket', ticketId: id });
    res.json({...visibleTicket(current,res.locals.user),sla:current.sla?slaView(current.sla,clock.now(),current.status):null});
  });
  app.post('/api/tickets/:id/reopen', async (req, res) => {
    z.object({}).strict().parse(req.body);
    const id = idOf(req);
    const ticket = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id = ${id} FOR UPDATE`;
      const current = await tx.ticket.findUnique({ where: { id } });
      if (!current || !(await canAccess(tx, res.locals.user, current))) fail(404, 'Ticket not found');
      if (!['RESOLVED', 'CLOSED'].includes(current.status))
        fail(409, 'Only resolved or closed tickets can be reopened');
      const t = await tx.ticket.update({
        where: { id },
        data: { status: 'OPEN', resolvedAt: null, closedAt: null, version: { increment: 1 } },
        include,
      });
      if(!t.sla)await tx.ticketSla.create({data:{ticketId:id,...await newSla(tx,t.priority,clock.now()),responseSatisfiedAt:t.firstRespondedAt,legacyBackfill:true}});
      else await advanceSla(tx,id,'OPEN',clock.now());
      await tx.event.create({
        data: {
          ticketId: id,
          actorId: res.locals.user.id,
          action: 'REOPENED',
          detail: 'Ticket reopened',
        },
      });
      return t;
    });
    const current=await db.ticket.findUniqueOrThrow({where:{id},include});
    res.json({...visibleTicket(current,res.locals.user),sla:current.sla?slaView(current.sla,clock.now(),current.status):null});
  });
  // Legacy Phase 1 summary, kept for API compatibility; the interface now uses /operations/summary
  // and /analytics. It reads every ticket in the caller's scope, so it shares the heavy-read limiter.
  app.get('/api/dashboard', heavyReadLimit, async (_req, res) => {
    const user = res.locals.user;
    const now = clock.now();
    // Both queries are scoped exactly like the list endpoints, so every figure is reproducible
    // from the same rows the caller can open.
    const [tickets, assets] = await Promise.all([
      db.ticket.findMany({
        where: user.role === 'EMPLOYEE' ? { requesterId: user.id } : {},
        include: { category: true, assignee: { select: { name: true } }, sla: true },
      }),
      db.asset.findMany({
        where: assetScope(user),
        select: { status: true, type: true, ownerId: true, warrantyExpiry: true },
      }),
    ]);
    res.json({
      ...metrics(tickets),
      sla: slaMetrics(tickets, now),
      assets: assetMetrics(assets, now),
    });
  });
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Endpoint not found')));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError)
      return res
        .status(400)
        .json({
          error: 'Invalid request',
          issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    // AI failures carry their own status: 503 disabled, 504 timeout, 429 usage limit, 502 upstream.
    // Without this the interface could not distinguish "try again" from "genuinely broken".
    if (err instanceof AiError) return res.status(err.status).json({ error: err.message });
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002')
        return res.status(409).json({ error: 'A record with that value already exists' });
      if (err.code === 'P2025') return res.status(404).json({ error: 'Record not found' });
    }
    // The database is unreachable (stopped, restarting, network): say so as a 503 the interface can
    // treat as "try again", rather than a generic failure. Nothing about the cause is echoed back.
    if (databaseUnavailable(err)) {
      logError(err, res.locals.requestId);
      res.setHeader('Retry-After', '5');
      return res.status(503).json({ error: 'The database is not reachable right now. Nothing was changed — try again in a moment.', requestId: res.locals.requestId });
    }
    if (err instanceof SyntaxError) return res.status(400).json({ error: 'Invalid JSON' });
    if (typeof err === 'object' && err !== null && 'type' in err && err.type === 'entity.too.large')
      return res.status(413).json({ error: 'Request is too large' });
    logError(err, res.locals.requestId);
    return res.status(500).json({ error: 'Something went wrong. Please try again.', requestId: res.locals.requestId });
  });
  return app;
}
