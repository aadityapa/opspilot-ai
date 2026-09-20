import {useState,useEffect,type ReactNode} from 'react';
import {api} from './api';
import {labels,type Asset,type CurrentUser,type Note,type Person,type SlaView,type Ticket,type TicketEvent} from '../shared/model';
export type {Asset};
export type Act=(work:()=>Promise<void>,success?:string)=>Promise<void>;
export const when=(s:string|null|undefined)=>s?new Date(s).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'—';
/** Renders a signed millisecond span as a compact human duration; callers decide the wording around it. */
export function duration(ms:number){
 const total=Math.floor(Math.abs(ms)/1000),d=Math.floor(total/86400),h=Math.floor(total%86400/3600),m=Math.floor(total%3600/60);
 const parts=d?[`${d}d`,`${h}h`]:h?[`${h}h`,`${m}m`]:[`${m}m`];
 return parts.join(' ');
}
/**
 * Fetches one path and never returns another path's payload. The loaded path is stored alongside the
 * data, because the reset inside the effect happens after the render that already changed the path:
 * without this guard a component renders one frame with the previous route's data in the new
 * route's shape, which crashed the asset detail page when a list response was read as a record.
 */
export function useRecord<T>(path:string,refresh=0){
 const [state,setState]=useState<{path:string;data?:T;error:string}>({path,error:''});
 useEffect(()=>{
  let active=true;
  // Refetching the *same* path keeps what is already on screen. Clearing it on every refresh made
  // each live update blank the page to a skeleton and remount the tree underneath, which flickered
  // and silently discarded whatever somebody had typed or selected but not yet saved. A *different*
  // path still clears, because the previous payload has the wrong shape for the new route.
  setState(prev=>prev.path===path?prev:{path,error:''});
  api<T>(path).then(v=>{if(active)setState({path,data:v,error:''});}).catch(e=>{if(active)setState({path,error:e.message});});
  return()=>{active=false;};
 },[path,refresh]);
 return state.path===path?{data:state.data,error:state.error}:{data:undefined,error:''};
}
export function Pending({error}:{error:string}){return <div className={error?'alert error':'loading'} role={error?'alert':'status'}>{error||'Loading…'}</div>;}
export function Title({title,children}:{title:string;children?:ReactNode}){return <div className="page-heading"><div><p className="eyebrow">OPERATIONS</p><h1>{title}</h1></div>{children}</div>;}
export function Pager({page,total,setPage}:{page:number;total:number;setPage:(p:number)=>void}){return <div className="pagination"><span>{total} records · Page {page} of {Math.max(1,Math.ceil(total/15))}</span><div className="flex"><button disabled={page===1} onClick={()=>setPage(page-1)}>Previous</button><button disabled={page*15>=total} onClick={()=>setPage(page+1)}>Next</button></div></div>;}
const types=['LAPTOP','DESKTOP','ACCESS_POINT','PRINTER','SWITCH'],states=['IN_USE','AVAILABLE','REPAIR','RETIRED'];
const label=(s:string)=>s.toLowerCase().replaceAll('_',' ').replace(/^./,v=>v.toUpperCase());
/**
 * The selection is controlled rather than a defaultValue. The option list is fetched after the
 * select first mounts, and an uncontrolled select silently falls back to "No linked asset" when its
 * initial value is not among the options yet — which meant saving an unrelated field on a ticket
 * that already had an asset would unlink it.
 */
export function AssetPicker({current}:{current?:Ticket['asset']}){
 const [q,setQ]=useState('');
 const [selected,setSelected]=useState(current?.id??'');
 const {data,error}=useRecord<{items:Asset[]}>(`/assets?q=${encodeURIComponent(q)}&pageSize=100`);
 const options=data?.items.filter(a=>a.status!=='RETIRED')??[];
 return <div className="asset-picker">
  <label>Find an asset<input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search authorized assets"/></label>
  <label>Linked asset
   <select aria-label="Linked asset" name="assetId" value={selected} onChange={e=>setSelected(e.target.value)}>
    <option value="">No linked asset</option>
    {current&&!options.some(a=>a.id===current.id)&&<option value={current.id}>{current.tag}</option>}
    {options.map(a=><option key={a.id} value={a.id}>{a.tag} · {a.model}</option>)}
   </select>
  </label>
  {error&&<p role="alert">{error}</p>}
 </div>;
}

/** Compact SLA state for list rows. Returns null when the ticket has no SLA record. */
export function SlaBadge({sla,status}:{sla:SlaView|null|undefined;status:string}){
 if(!sla)return <span className="muted fine">No SLA record</span>;
 if(sla.responseBreachAt||sla.resolutionBreachAt)return <span className="badge breach">SLA breached</span>;
 if(sla.stopped)return <span className="badge met">Within SLA</span>;
 if(sla.paused)return <span className="badge paused">Paused</span>;
 const shares=[
  ...(sla.responseSatisfiedAt?[]:[sla.remainingResponseMs/(sla.responseMinutes*60000)]),
  ...(status==='WAITING_FOR_USER'?[]:[sla.remainingResolutionMs/(sla.resolutionMinutes*60000)]),
 ];
 const remaining=Math.min(...[sla.responseSatisfiedAt?Infinity:sla.remainingResponseMs,sla.remainingResolutionMs]);
 return shares.length&&Math.min(...shares)<=0.25
  ? <span className="badge at-risk">{duration(remaining)} left</span>
  : <span className="badge running">{duration(remaining)} left</span>;
}
/** Full SLA panel for the ticket detail page. Every value comes from the ticket's own policy snapshot. */
export function SlaPanel({sla,status}:{sla:SlaView|null|undefined;status:string}){
 if(!sla)return (
  <section className="panel">
   <div className="panel-head"><h2>Service level</h2></div>
   <p className="muted">No SLA record exists for this ticket. Reopening it will start a clearly marked fresh clock.</p>
  </section>
 );
 const responseState=sla.responseBreachAt
  ? {tone:'breach',label:'Breached',detail:`Deadline passed ${when(sla.responseBreachAt)}`}
  : sla.responseSatisfiedAt
    ? {tone:'met',label:'Met',detail:`First public engineer reply ${when(sla.responseSatisfiedAt)}`}
    : {tone:sla.remainingResponseMs<=sla.responseMinutes*60000*0.25?'at-risk':'running',label:`${duration(sla.remainingResponseMs)} remaining`,detail:`Due ${when(sla.responseDueAt)}`};
 const resolutionState=sla.resolutionBreachAt
  ? {tone:'breach',label:'Breached',detail:`Deadline passed ${when(sla.resolutionBreachAt)}`}
  : sla.stopped
    ? {tone:'met',label:'Stopped',detail:`${duration(sla.elapsedMs)} of ${duration(sla.resolutionMinutes*60000)} used before resolution`}
    : sla.paused
      ? {tone:'paused',label:'Paused',detail:`${duration(sla.remainingResolutionMs)} remaining when the requester replies`}
      : {tone:sla.remainingResolutionMs<=sla.resolutionMinutes*60000*0.25?'at-risk':'running',label:`${duration(sla.remainingResolutionMs)} remaining`,detail:`Due ${when(sla.resolutionDueAt)}`};
 return (
  <section className="panel sla-panel">
   <div className="panel-head"><h2>Service level</h2><span className="muted fine">24/7 clock · stored in UTC</span></div>
   <div className="sla-rows">
    {[['First response',responseState],['Resolution',resolutionState]].map(([name,state])=>{
     const s=state as {tone:string;label:string;detail:string};
     return (
      <div className="sla-row" key={String(name)}>
       <div className="flex between">
        <span>{String(name)}</span>
        <span className={`badge ${s.tone}`}>{s.label}</span>
       </div>
       <small className="muted">{s.detail}</small>
      </div>
     );
    })}
   </div>
   <p className="muted fine">
    Policy snapshot taken when this ticket started: {sla.responseMinutes} minute first response, {sla.resolutionMinutes} minute
    resolution, at {labels[sla.priority] ?? sla.priority} priority. Later administrator changes to SLA settings do not alter this
    ticket. Resolution time pauses while the ticket is Waiting for User and stops at resolution; first-response time never pauses.
    {sla.legacyBackfill?' This ticket predates SLA tracking and was given a marked fresh clock at upgrade.':''}
   </p>
  </section>
 );
}
/** Support-only internal notes and the full audit timeline. Employees never render or request this component. */
/** Internal notes: the list (staff only). The form lives in the composer's "Internal note" tab. */
export function InternalNotes({ticketId,refresh}:{ticketId:string;refresh:number}){
 const {data:notes,error}=useRecord<Note[]>(`/tickets/${ticketId}/notes`,refresh);
 return (
  <section className="notes-section" aria-labelledby="notes-h">
   <div className="section-title"><h2 id="notes-h" className="private-h"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>Internal notes</h2><span className="private-tag">Support team only · never shown to the requester</span></div>
   {!notes?<Pending error={error}/>:notes.length?(
    <ol className="thread">{notes.map(n=>(
     <li className="msg internal" key={n.id}>
      <span className="avatar">{n.author.name.split(' ').map(x=>x[0]).slice(0,2).join('')}</span>
      <div className="msg-body">
       <div className="msg-head"><strong>{n.author.name}</strong><span className="muted">{labels[n.author.role]??n.author.role} · {when(n.createdAt)}</span><span className="private-tag small">Internal note</span></div>
       <p>{n.body}</p>
      </div>
     </li>
    ))}</ol>
   ):<p className="muted t-sm">No internal notes yet.</p>}
  </section>
 );
}
export function InternalNoteForm({ticketId,act,busy,autoFocus}:{ticketId:string;act:Act;busy:boolean;autoFocus?:boolean}){
 const [body,setBody]=useState('');
 const submit=()=>{if(!body.trim())return;void act(async()=>{await api(`/tickets/${ticketId}/notes`,'POST',{body});setBody('');},'Internal note added.');};
 return (
  <form className="composer-form" onSubmit={e=>{e.preventDefault();submit();}}>
   <label>
    <span className="sr-only">Internal note</span>
    <textarea aria-label="Internal note" id="internal-note" required maxLength={10000} rows={4} value={body} autoFocus={autoFocus} onChange={e=>setBody(e.target.value)} placeholder="Investigation detail for the support team. Never include passwords or access keys." onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();submit();}}}/>
   </label>
   <div className="composer-actions">
    <span className="private-tag"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>Hidden from the requester</span>
    <span className="grow"/>
    <span className="muted fine">Ctrl+Enter</span>
    <button disabled={busy||!body.trim()}>{busy?'Saving…':'Add internal note'}</button>
   </div>
  </form>
 );
}
/** Append-only audit events for support staff. */
export function EventsTimeline({ticketId,refresh}:{ticketId:string;refresh:number}){
 const {data:events,error}=useRecord<TicketEvent[]>(`/tickets/${ticketId}/events`,refresh);
 return (
  <section className="events-section" aria-labelledby="events-h">
   <div className="section-title"><h2 id="events-h">Activity timeline</h2><span className="muted t-caption">Audit records are append-only</span></div>
   {!events?<Pending error={error}/>:events.length?(
    <ol className="sys-timeline">
     {events.map(e=>(
      <li key={e.id}>
       <time>{new Date(e.createdAt).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',hour12:false})}<small>{new Date(e.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</small></time>
       <span className="tl-mark" aria-hidden="true"/>
       <span className="tl-body"><strong>{e.actor?.name??'System'}</strong> <span>{(labels[e.action]??e.action.toLowerCase().replaceAll('_',' ')).toLowerCase()}</span><small>{e.detail}</small></span>
      </li>
     ))}
    </ol>
   ):<p className="muted t-sm">No recorded activity yet.</p>}
  </section>
 );
}
