import {log} from './observability.js';
import {Router} from 'express';
import {randomUUID} from 'node:crypto';
import nodemailer from 'nodemailer';
import {db} from './db.js';
import {config} from './config.js';
import {admin,fail,idOf} from './http.js';
import {z} from 'zod';
import {pageSchema} from '../shared/operations.js';
import {notifyPrefsSchema} from '../shared/contracts.js';
import {systemClock,evaluateSla,type Clock} from './sla.js';
import type {Prisma,NotificationKind,Ticket} from '../generated/prisma/client.js';
import {canReadTicket} from './domain.js';
import {notifyUsers} from './realtime.js';
const messages:Record<NotificationKind,string>={ASSIGNMENT:'A ticket has been assigned to you.',PUBLIC_REPLY:'A public reply was added to your ticket.',SLA_RESPONSE:'The first-response SLA deadline was breached.',SLA_RESOLUTION:'The resolution SLA deadline was breached.',MENTION:'You were mentioned on a ticket.',WATCHED_UPDATE:'A ticket you follow was updated.',APPROVAL_REQUESTED:'A request is waiting for your approval.',APPROVAL_DECIDED:'A decision was made on your request.',SURVEY_REQUEST:'Your ticket was resolved. How did we do?'};
export function notificationText(kind:NotificationKind,number:number){return `${messages[kind]}\nTicket OPS-${number}. Sign in to OpsPilot to review it.`;}
/** Which per-user preference switches each kind off. SLA breaches and approvals are never silenced for the people who own them. */
const prefKey:Record<NotificationKind,keyof NotifyPrefs|null>={ASSIGNMENT:'assignment',PUBLIC_REPLY:'reply',SLA_RESPONSE:'sla',SLA_RESOLUTION:'sla',MENTION:'mention',WATCHED_UPDATE:'watched',APPROVAL_REQUESTED:null,APPROVAL_DECIDED:'approval',SURVEY_REQUEST:'survey'};
export interface NotifyPrefs {assignment:boolean;reply:boolean;mention:boolean;watched:boolean;sla:boolean;approval:boolean;survey:boolean}
export const defaultPrefs:NotifyPrefs={assignment:true,reply:true,mention:true,watched:true,sla:true,approval:true,survey:true};
export const prefsOf=(raw:unknown):NotifyPrefs=>({...defaultPrefs,...(raw&&typeof raw==='object'?raw as Partial<NotifyPrefs>:{})});
const wants=(prefs:unknown,kind:NotificationKind)=>{const key=prefKey[kind];return key===null||prefsOf(prefs)[key];};
/**
 * Queues one message per authorized recipient. `dedupeKey` is unique, so re-running the same
 * enqueue — a repeated assignment save, a repeated breach scan, or a retried transaction — inserts
 * nothing new. Timestamps come from the caller's clock rather than a database default so the whole
 * delivery path is deterministic under test.
 */
export async function enqueue(tx:Prisma.TransactionClient,ticket:Pick<Ticket,'id'|'requesterId'|'assigneeId'>,kind:NotificationKind,key:string,now:Date,actorId?:string,explicitRecipients?:string[]){
 let recipients:(string|null)[]=explicitRecipients??(kind==='ASSIGNMENT'?[ticket.assigneeId]:[ticket.requesterId,ticket.assigneeId]);
 if(!explicitRecipients&&kind!=='ASSIGNMENT'&&!ticket.assigneeId){const admins=await tx.user.findMany({where:{active:true,role:'ADMIN'},select:{id:true}});recipients.push(...admins.map(u=>u.id));}
 const ids=[...new Set(recipients.filter((id):id is string=>!!id&&id!==actorId))];
 const users=await tx.user.findMany({where:{id:{in:ids},active:true,deletedAt:null},select:{id:true,role:true,notifyPrefs:true}});
 // Approvers and mentioned people may be employees who are not the requester; the caller vouched for them by naming them explicitly.
 const allowed=users.filter(u=>(explicitRecipients?true:canReadTicket(u,ticket))&&wants(u.notifyPrefs,kind));
 await tx.outbox.createMany({data:allowed.map(u=>({dedupeKey:`${key}:${kind}:${u.id}`,recipientId:u.id,ticketId:ticket.id,kind,createdAt:now,nextAttemptAt:now})),skipDuplicates:true});
 notifyUsers(allowed.map(u=>u.id),{type:'notification',ticketId:ticket.id});
}
export async function scanBreaches(clock:Clock=systemClock){
 const tickets=await db.ticketSla.findMany({select:{ticketId:true}});
 for(const {ticketId} of tickets)await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id=${ticketId} FOR UPDATE`;
  const ticket=await tx.ticket.findUnique({where:{id:ticketId},include:{sla:true}});if(!ticket?.sla)return;
  const values=evaluateSla(ticket.sla,clock.now());
  if(values.responseBreachAt?.getTime()!==ticket.sla.responseBreachAt?.getTime()||values.resolutionBreachAt?.getTime()!==ticket.sla.resolutionBreachAt?.getTime())await tx.ticketSla.update({where:{ticketId},data:values});
  if(values.responseBreachAt)await enqueue(tx,ticket,'SLA_RESPONSE',`sla:${ticket.sla.id}`,clock.now());
  if(values.resolutionBreachAt)await enqueue(tx,ticket,'SLA_RESOLUTION',`sla:${ticket.sla.id}`,clock.now());
 });
}
export interface Delivery {to:string;subject:string;text:string;messageId:string}
export type Sender=(message:Delivery)=>Promise<void>;
export async function sendToMailpit(message:Delivery){
 if(config.MAIL_MODE!=='mailpit'||config.NODE_ENV==='production')throw new Error('Local Mailpit delivery is disabled');
 // Fixed sink settings, no SMTP URL, relay, auth, attachments, or externally supplied host.
 const transport=nodemailer.createTransport({host:config.MAILPIT_HOST,port:1025,secure:false,ignoreTLS:true,connectionTimeout:5000,greetingTimeout:5000,socketTimeout:10000,disableFileAccess:true,disableUrlAccess:true});
 try{await transport.sendMail({from:'OpsPilot Demo <notifications@opspilot.example>',...message});}finally{transport.close();}
}
export async function deliverOne(sender:Sender=sendToMailpit,clock:Clock=systemClock){
 const now=clock.now();const leaseToken=randomUUID();
 const job=await db.$transaction(async tx=>{
  const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "Outbox" WHERE (status='PENDING' AND "nextAttemptAt"<=${now}) OR (status='PROCESSING' AND "leaseUntil"<${now}) ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED`;
  if(!rows[0])return null;
  return tx.outbox.update({where:{id:rows[0].id},data:{status:'PROCESSING',attempts:{increment:1},leaseToken,leaseUntil:new Date(now.getTime()+60000)},include:{recipient:true,ticket:true}});
 });
 if(!job)return false;
 const ownership={id:job.id,leaseToken};
 if(!job.recipient.active||!canReadTicket(job.recipient,job.ticket)||(job.kind==='ASSIGNMENT'&&(job.recipient.role==='EMPLOYEE'||job.ticket.assigneeId!==job.recipientId))){await db.outbox.updateMany({where:ownership,data:{status:'CANCELLED',leaseUntil:null,leaseToken:null,lastError:'Recipient no longer authorized'}});return true;}
 try{
  await sender({to:job.recipient.email,subject:`OpsPilot · OPS-${job.ticket.number}`,text:notificationText(job.kind,job.ticket.number),messageId:`<${job.id}@opspilot.example>`});
  await db.outbox.updateMany({where:ownership,data:{status:'SENT',sentAt:clock.now(),leaseUntil:null,leaseToken:null,lastError:null}});
 }catch{
  await db.outbox.updateMany({where:ownership,data:{status:job.attempts>=5?'FAILED':'PENDING',nextAttemptAt:new Date(clock.now().getTime()+Math.min(3600000,30000*2**(job.attempts-1))),leaseUntil:null,leaseToken:null,lastError:'Local mail delivery failed; retry scheduled or exhausted'}});
 }
 return true;
}
export function startWorker(){let running=false;const tick=async()=>{if(running)return;running=true;try{await scanBreaches();if(config.MAIL_MODE==='mailpit'&&config.NODE_ENV!=='production')for(let i=0;i<20;i++)if(!await deliverOne())break;}catch(e){log('warn','operations worker tick failed; will retry',{errorName:(e as Error).name,errorMessage:(e as Error).message.slice(0,160)});}finally{running=false;}};void tick();const timer=setInterval(()=>void tick(),30000);timer.unref();return()=>clearInterval(timer);}
export const notificationRouter=Router();
/** Employees see notifications on their own tickets plus the ones addressed to them explicitly (mentions, approvals). */
const inboxWhere=(user:{id:string;role:string})=>({recipientId:user.id,...(user.role==='EMPLOYEE'?{OR:[{ticket:{requesterId:user.id}},{kind:{in:['MENTION','APPROVAL_REQUESTED','APPROVAL_DECIDED'] as NotificationKind[]}}]}:{})});
notificationRouter.get('/notifications',async(req,res)=>{const f=pageSchema.parse(req.query);const user=res.locals.user;const where=inboxWhere(user);const [items,total,unread]=await db.$transaction([db.outbox.findMany({where,select:{id:true,kind:true,createdAt:true,readAt:true,ticketId:true,ticket:{select:{number:true,title:true}}},orderBy:[{createdAt:'desc'},{id:'asc'}],skip:(f.page-1)*f.pageSize,take:f.pageSize}),db.outbox.count({where}),db.outbox.count({where:{...where,readAt:null}})]);res.json({items:items.map(n=>({...n,text:notificationText(n.kind,n.ticket.number)})),total,unread,page:f.page,pageSize:f.pageSize});});
notificationRouter.get('/notifications/unread',async(_req,res)=>{res.json({unread:await db.outbox.count({where:{...inboxWhere(res.locals.user),readAt:null}})});});
notificationRouter.post('/notifications/read',async(req,res)=>{const {ids}=z.object({ids:z.array(z.uuid()).max(200).optional()}).strict().parse(req.body);const where={...inboxWhere(res.locals.user),readAt:null,...(ids?{id:{in:ids}}:{})};const r=await db.outbox.updateMany({where,data:{readAt:new Date()}});res.json({marked:r.count});});
notificationRouter.get('/notifications/preferences',(_req,res)=>res.json(prefsOf(res.locals.account.notifyPrefs)));
notificationRouter.put('/notifications/preferences',async(req,res)=>{const prefs=notifyPrefsSchema.parse(req.body);await db.user.update({where:{id:res.locals.user.id},data:{notifyPrefs:prefs}});res.json(prefs);});
notificationRouter.get('/admin/outbox',admin,async(req,res)=>{const f=pageSchema.parse(req.query);const [items,total]=await db.$transaction([db.outbox.findMany({include:{recipient:{select:{name:true}}},orderBy:[{createdAt:'desc'},{id:'asc'}],skip:(f.page-1)*f.pageSize,take:f.pageSize}),db.outbox.count()]);res.json({items,total,page:f.page,pageSize:f.pageSize});});
notificationRouter.post('/admin/outbox/:id/retry',admin,async(req,res)=>{const id=idOf(req);await db.$transaction(async tx=>{const updated=await tx.outbox.updateMany({where:{id,status:'FAILED'},data:{status:'PENDING',attempts:0,nextAttemptAt:new Date(),lastError:null}});if(!updated.count)fail(409,'Only failed notifications can be retried');await tx.event.create({data:{actorId:res.locals.user.id,action:'NOTIFICATION_RETRY',detail:`Retry requested for outbox ${id}`,internal:true}});});res.status(204).end();});
