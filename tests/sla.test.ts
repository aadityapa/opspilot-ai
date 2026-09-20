import {describe,it,expect} from 'vitest';
import {evaluateSla,elapsed,slaView,type SlaState} from '../server/sla.js';
const start=new Date('2026-01-01T00:00:00Z');
const at=(m:number)=>new Date(start.getTime()+m*60000);
const state=():SlaState=>({id:'s',ticketId:'t',priority:'HIGH',responseMinutes:10,resolutionMinutes:60,startedAt:start,responseDueAt:at(10),responseSatisfiedAt:null,responseBreachAt:null,resolutionBreachAt:null,elapsedMs:0,runningSince:start,legacyBackfill:false});
describe('24/7 SLA clock',()=>{
 it('accepts exact-deadline response and breaches immediately after',()=>{expect(evaluateSla({...state(),responseSatisfiedAt:at(10)},at(100)).responseBreachAt).toBeNull();expect(evaluateSla(state(),new Date(at(10).getTime()+1)).responseBreachAt).toEqual(at(10));});
 it('does not pause first response while resolution is paused',()=>{const paused={...state(),elapsedMs:20*60000,runningSince:null};expect(elapsed(paused,at(1000))).toBe(20*60000);expect(evaluateSla(paused,at(1000)).responseBreachAt).toEqual(at(10));expect(slaView(paused,at(1000),'WAITING_FOR_USER').resolutionDueAt).toBeNull();});
 it('resumes remaining budget rather than resetting it',()=>{const resumed={...state(),elapsedMs:20*60000,runningSince:at(120)};expect(slaView(resumed,at(130),'IN_PROGRESS').remainingResolutionMs).toBe(30*60000);expect(evaluateSla(resumed,at(161)).resolutionBreachAt).toEqual(at(160));});
 it('stops resolution time and retains breach history on reopening',()=>{const stopped={...state(),elapsedMs:61*60000,runningSince:null,resolutionBreachAt:at(60)};expect(elapsed(stopped,at(900))).toBe(61*60000);const reopened={...stopped,runningSince:at(900)};expect(evaluateSla(reopened,at(901)).resolutionBreachAt).toEqual(at(60));expect(elapsed(reopened,at(901))).toBe(62*60000);});
 it('computes equally from restored persisted dates after restart',()=>{const s={...state(),elapsedMs:12*60000,runningSince:at(90)};const json=JSON.parse(JSON.stringify(s));const restored={...json,startedAt:new Date(json.startedAt),responseDueAt:new Date(json.responseDueAt),runningSince:new Date(json.runningSince)};expect(slaView(restored,at(100),'IN_PROGRESS')).toEqual(slaView(s,at(100),'IN_PROGRESS'));});
});
