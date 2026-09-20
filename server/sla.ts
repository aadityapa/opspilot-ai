import {Router} from 'express';
import {z} from 'zod';
import {db} from './db.js';
import {admin} from './http.js';
import {priorities,type SlaMetrics,type Status} from '../shared/model.js';
import type {Prisma,TicketSla} from '../generated/prisma/client.js';
export interface Clock {now():Date}
export const systemClock:Clock={now:()=>new Date()};
export type SlaState=Pick<TicketSla,'id'|'ticketId'|'priority'|'responseMinutes'|'resolutionMinutes'|'startedAt'|'responseDueAt'|'responseSatisfiedAt'|'responseBreachAt'|'resolutionBreachAt'|'elapsedMs'|'runningSince'|'legacyBackfill'>;
export function elapsed(s:SlaState,now:Date){return s.elapsedMs+(s.runningSince?Math.max(0,now.getTime()-s.runningSince.getTime()):0);}
export function evaluateSla(s:SlaState,now:Date){
 const responseEnd=s.responseSatisfiedAt??now;
 const responseBreachAt=s.responseBreachAt??(responseEnd>s.responseDueAt?s.responseDueAt:null);
 const spent=elapsed(s,now);const budget=s.resolutionMinutes*60000;
 const resolutionBreachAt=s.resolutionBreachAt??(spent>budget?(s.runningSince?new Date(s.runningSince.getTime()+Math.max(0,budget-s.elapsedMs)):now):null);
 return {responseBreachAt,resolutionBreachAt};
}
/**
 * Read model for one ticket. `elapsedMs` is the live consumed budget (persisted time plus any
 * currently running interval), not the raw stored column, so a running ticket reports the time it
 * has actually used. When the clock is paused or stopped the two are identical by definition.
 */
export function slaView(s:SlaState,now:Date,status:string){const breaches=evaluateSla(s,now);return {...s,...breaches,elapsedMs:elapsed(s,now),remainingResponseMs:s.responseDueAt.getTime()-(s.responseSatisfiedAt??now).getTime(),remainingResolutionMs:s.resolutionMinutes*60000-elapsed(s,now),resolutionDueAt:s.runningSince?new Date(now.getTime()+s.resolutionMinutes*60000-elapsed(s,now)):null,paused:status==='WAITING_FOR_USER',stopped:['RESOLVED','CLOSED'].includes(status),asOf:now};}
export async function newSla(tx:Prisma.TransactionClient,priority:typeof priorities[number],now:Date){const policy=await tx.slaPolicy.findUniqueOrThrow({where:{priority}});return {priority,responseMinutes:policy.responseMinutes,resolutionMinutes:policy.resolutionMinutes,startedAt:now,responseDueAt:new Date(now.getTime()+policy.responseMinutes*60000),runningSince:now};}
// Called under the ticket row lock. Persisted elapsed time makes restart/reopen behavior deterministic.
export async function advanceSla(tx:Prisma.TransactionClient,ticketId:string,status:Status,now:Date,satisfyResponse=false){const s=await tx.ticketSla.findUnique({where:{ticketId}});if(!s)return;const updated={...s,...(satisfyResponse&&!s.responseSatisfiedAt?{responseSatisfiedAt:now}:{})};return tx.ticketSla.update({where:{ticketId},data:{...evaluateSla(updated,now),elapsedMs:elapsed(s,now),runningSince:['OPEN','IN_PROGRESS'].includes(status)?now:null,...(satisfyResponse&&!s.responseSatisfiedAt?{responseSatisfiedAt:now}:{})}});}
/** A ticket reaching Resolved or Closed has a final resolution outcome; anything else is still running or paused. */
const finished=(status:string)=>['RESOLVED','CLOSED'].includes(status);
/** Remaining budget at or below this share of the target counts as "at risk". */
export const atRiskShare=0.25;
export interface SlaScopeTicket {id:string;number:number;title:string;status:string;sla:SlaState|null}
/**
 * Dashboard SLA figures, computed from stored TicketSla rows with explicit denominators:
 * response compliance is measured only over tickets that already received a first public
 * engineer response; resolution compliance only over tickets that reached Resolved or Closed.
 * Tickets still waiting are reported separately as breached or at risk, never folded into a
 * compliance percentage, so no percentage is produced from an unfinished outcome.
 */
export function slaMetrics(tickets:SlaScopeTicket[],now:Date):SlaMetrics{
 let responseMeasured=0,responseBreached=0,resolutionMeasured=0,resolutionBreached=0,activeBreached=0,activeAtRisk=0;
 const breachedTickets:SlaMetrics['breachedTickets']=[];
 const tracked=tickets.filter((t):t is SlaScopeTicket&{sla:SlaState}=>t.sla!==null);
 for(const t of tracked){
  const s=t.sla,{responseBreachAt,resolutionBreachAt}=evaluateSla(s,now),done=finished(t.status);
  if(s.responseSatisfiedAt){responseMeasured++;if(responseBreachAt)responseBreached++;}
  if(done){resolutionMeasured++;if(resolutionBreachAt)resolutionBreached++;continue;}
  if(responseBreachAt||resolutionBreachAt){
   activeBreached++;
   if(responseBreachAt)breachedTickets.push({id:t.id,number:t.number,title:t.title,kind:'RESPONSE'});
   if(resolutionBreachAt)breachedTickets.push({id:t.id,number:t.number,title:t.title,kind:'RESOLUTION'});
   continue;
  }
  const shares=[
   ...(s.responseSatisfiedAt?[]:[(s.responseDueAt.getTime()-now.getTime())/(s.responseMinutes*60000)]),
   ...(t.status==='WAITING_FOR_USER'?[]:[(s.resolutionMinutes*60000-elapsed(s,now))/(s.resolutionMinutes*60000)]),
  ];
  if(shares.length&&Math.min(...shares)<=atRiskShare)activeAtRisk++;
 }
 const percent=(measured:number,breached:number)=>measured?Math.round(((measured-breached)/measured)*1000)/10:null;
 return {tracked:tracked.length,responseMeasured,responseBreached,responseCompliancePercent:percent(responseMeasured,responseBreached),
  resolutionMeasured,resolutionBreached,resolutionCompliancePercent:percent(resolutionMeasured,resolutionBreached),
  activeBreached,activeAtRisk,breachedTickets:breachedTickets.sort((a,b)=>a.number-b.number).slice(0,20)};
}
export const slaPolicySchema=z.object({responseMinutes:z.number().int().min(1).max(43200),resolutionMinutes:z.number().int().min(1).max(525600)}).strict();
export const slaRouter=Router();
slaRouter.get('/admin/sla',admin,async(_req,res)=>res.json(await db.slaPolicy.findMany({orderBy:{priority:'asc'}})));
slaRouter.put('/admin/sla/:priority',admin,async(req,res)=>{const priority=z.enum(priorities).parse(req.params.priority);const data=slaPolicySchema.parse(req.body);const policy=await db.$transaction(async tx=>{const before=await tx.slaPolicy.findUnique({where:{priority}});const p=await tx.slaPolicy.update({where:{priority},data});await tx.event.create({data:{actorId:res.locals.user.id,action:'SLA_POLICY_UPDATED',detail:`${priority}: ${JSON.stringify(before)} → ${JSON.stringify(data)}. Existing snapshots unchanged.`,internal:true}});return p;});res.json(policy);});
/**
 * Where one active ticket stands against its SLA right now: breached, at risk (tightest remaining
 * budget at or below `atRiskShare`), or healthy, with the remaining budget in milliseconds. Finished
 * tickets and tickets without a policy have no position. Shared by the list filter and the
 * operations summary so "at risk" means one thing everywhere.
 */
export function slaPosition(t:{status:string;sla:SlaState|null},now:Date):{breached:boolean;atRisk:boolean;remainingMs:number|null;breachedAt:Date|null}{
 if(!t.sla||finished(t.status))return {breached:false,atRisk:false,remainingMs:null,breachedAt:null};
 const {responseBreachAt,resolutionBreachAt}=evaluateSla(t.sla,now);
 if(responseBreachAt||resolutionBreachAt){
  const at=[responseBreachAt,resolutionBreachAt].filter((d):d is Date=>!!d).sort((a,b)=>a.getTime()-b.getTime())[0];
  return {breached:true,atRisk:false,remainingMs:0,breachedAt:at};
 }
 const budgets=[
  ...(t.sla.responseSatisfiedAt?[]:[{remaining:t.sla.responseDueAt.getTime()-now.getTime(),total:t.sla.responseMinutes*60000}]),
  ...(t.status==='WAITING_FOR_USER'?[]:[{remaining:t.sla.resolutionMinutes*60000-elapsed(t.sla,now),total:t.sla.resolutionMinutes*60000}]),
 ];
 if(!budgets.length)return {breached:false,atRisk:false,remainingMs:null,breachedAt:null};
 const tightest=budgets.reduce((a,b)=>(a.remaining/a.total<=b.remaining/b.total?a:b));
 return {breached:false,atRisk:tightest.remaining/tightest.total<=atRiskShare,remainingMs:tightest.remaining,breachedAt:null};
}
