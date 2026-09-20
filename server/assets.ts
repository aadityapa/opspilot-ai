import { Router } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { admin, fail, idOf, person } from './http.js';
import { assetSchema,assetUpdateSchema,pageSchema,assetStatuses,assetTypes } from '../shared/operations.js';
import type { AssetMetrics, CurrentUser } from '../shared/model.js';
import type { Prisma } from '../generated/prisma/client.js';
/** Assets counted here are exactly the rows the caller is allowed to list, so the summary always matches their inventory page. */
export function assetMetrics(assets:{status:string;type:string;ownerId:string|null;warrantyExpiry:Date|null}[],now:Date):AssetMetrics{
 const horizon=now.getTime()+90*24*60*60*1000;
 const count=(key:(a:typeof assets[number])=>string)=>assets.reduce<Record<string,number>>((a,x)=>{const k=key(x);a[k]=(a[k]??0)+1;return a;},{});
 return {total:assets.length,byStatus:count(a=>a.status),byType:count(a=>a.type),
  unassigned:assets.filter(a=>!a.ownerId&&a.status!=='RETIRED').length,
  warrantyExpiring90Days:assets.filter(a=>a.status!=='RETIRED'&&a.warrantyExpiry!==null&&a.warrantyExpiry.getTime()>=now.getTime()&&a.warrantyExpiry.getTime()<=horizon).length};
}
export function assetScope(user:CurrentUser):Prisma.AssetWhereInput {
 if(user.role==='ADMIN')return {};
 if(user.role==='EMPLOYEE')return {ownerId:user.id};
 return {OR:[{ownerId:null},{ownerId:user.id},{owner:{requests:{some:{}}}},{tickets:{some:{}}}]};
}
export async function checkAssetLink(tx:Prisma.TransactionClient,user:CurrentUser,assetId:string|null|undefined,requesterId:string){
 if(!assetId)return;
 await tx.$queryRaw`SELECT id FROM "Asset" WHERE id=${assetId} FOR SHARE`;
 const asset=await tx.asset.findFirst({where:{AND:[{id:assetId,status:{not:'RETIRED'}},assetScope(user)]}});
 if(!asset)fail(404,'Asset not found');
 if(user.role==='EMPLOYEE'&&asset.ownerId!==requesterId)fail(404,'Asset not found');
}
function dates(data:z.infer<typeof assetSchema>){return {...data,purchaseDate:data.purchaseDate?new Date(data.purchaseDate+'T00:00:00Z'):null,warrantyExpiry:data.warrantyExpiry?new Date(data.warrantyExpiry+'T00:00:00Z'):null};}
export const assetRouter=Router();
/** Owner rows carry their department so the inventory can be read by business unit, not just by person. */
const assetOwner={select:{...person,title:true,department:{select:{id:true,name:true,code:true}}}} as const;
/** Query shape shared by the list and its summary, so the strip can never disagree with the rows. */
const assetQuery=pageSchema.extend({
 status:z.enum(assetStatuses).optional(),
 type:z.enum(assetTypes).optional(),
 ownerId:z.union([z.uuid(),z.literal('none')]).optional(),
 departmentId:z.uuid().optional(),
 warranty:z.enum(['expiring','expired']).optional(),
 sort:z.enum(['tag','updated','warranty']).default('tag'),
});
function assetFilter(f:z.infer<typeof assetQuery>,user:CurrentUser,now:Date):Prisma.AssetWhereInput{
 const horizon=new Date(now.getTime()+90*24*60*60*1000);
 return {AND:[assetScope(user),{
  ...(f.status?{status:f.status}:{}),
  ...(f.type?{type:f.type}:{}),
  ...(f.ownerId?(f.ownerId==='none'?{ownerId:null}:{ownerId:f.ownerId}):{}),
  ...(f.departmentId?{owner:{departmentId:f.departmentId}}:{}),
  ...(f.warranty==='expiring'?{status:{not:'RETIRED' as const},warrantyExpiry:{gte:now,lte:horizon}}:{}),
  ...(f.warranty==='expired'?{status:{not:'RETIRED' as const},warrantyExpiry:{lt:now}}:{}),
  ...(f.q?{OR:['tag','model','manufacturer','serialNumber'].map(k=>({[k]:{contains:f.q,mode:'insensitive'}})).concat([{owner:{name:{contains:f.q,mode:'insensitive'}}} as never])}:{}),
 }]};
}
assetRouter.get('/assets',async(req,res)=>{
 const f=assetQuery.parse(req.query);
 const where=assetFilter(f,res.locals.user,new Date());
 const orderBy=f.sort==='updated'?{updatedAt:'desc' as const}:f.sort==='warranty'?{warrantyExpiry:'asc' as const}:{tag:'asc' as const};
 const [total,items]=await db.$transaction([db.asset.count({where}),db.asset.findMany({where,include:{owner:assetOwner},orderBy,skip:(f.page-1)*f.pageSize,take:f.pageSize})],{isolationLevel:'RepeatableRead'});res.json({items,total,page:f.page,pageSize:f.pageSize});
});
/**
 * Inventory totals over everything the caller may list — not over the current page — using the
 * same filter as the list itself, so a filtered view reports the figures for that view.
 */
assetRouter.get('/assets/summary',async(req,res)=>{
 const f=assetQuery.parse(req.query);
 const now=new Date();
 const rows=await db.asset.findMany({where:assetFilter(f,res.locals.user,now),select:{status:true,type:true,ownerId:true,warrantyExpiry:true}});
 const metrics=assetMetrics(rows,now);
 res.json({...metrics,
  assigned:rows.filter(a=>a.ownerId&&a.status!=='RETIRED').length,
  retired:rows.filter(a=>a.status==='RETIRED').length,
  attention:rows.filter(a=>a.status==='REPAIR'||(a.status!=='RETIRED'&&a.warrantyExpiry!==null&&a.warrantyExpiry.getTime()<=now.getTime()+90*24*60*60*1000)).length,
 });
});
assetRouter.get('/assets/:id',async(req,res)=>{
 const user=res.locals.user;
 const asset=await db.asset.findFirst({where:{AND:[{id:idOf(req)},assetScope(user)]},include:{
  owner:{select:{...person,title:true,email:true,location:true,department:{select:{id:true,name:true,code:true}}}},
  // Service history is scoped like everything else: an employee sees only the tickets they raised.
  tickets:{where:user.role==='EMPLOYEE'?{requesterId:user.id}:{},select:{id:true,number:true,title:true,status:true,type:true,priority:true,createdAt:true,resolvedAt:true,requester:{select:person}},orderBy:{createdAt:'desc'},take:50},
 }});
 if(!asset)fail(404,'Asset not found');
 res.json(asset);
});
assetRouter.post('/assets',admin,async(req,res)=>{const data=dates(assetSchema.parse(req.body));const asset=await db.$transaction(async tx=>{if(data.ownerId&&!await tx.user.findFirst({where:{id:data.ownerId,role:'EMPLOYEE',active:true}}))fail(400,'Owner must be an active employee');const asset=await tx.asset.create({data,include:{owner:{select:person}}});await tx.event.create({data:{actorId:res.locals.user.id,action:'ASSET_CREATED',detail:`Asset ${asset.tag} (${asset.id}) created`,internal:true}});return asset;});res.status(201).json(asset);});
assetRouter.patch('/assets/:id',admin,async(req,res)=>{const parsed=assetUpdateSchema.parse(req.body);const data=dates(parsed.asset);const id=idOf(req);const asset=await db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Asset" WHERE id=${id} FOR UPDATE`;const before=await tx.asset.findUnique({where:{id}});if(!before)fail(404,'Asset not found');if(before.version!==parsed.version)fail(409,'Asset changed. Refresh and try again.');if(data.ownerId&&!await tx.user.findFirst({where:{id:data.ownerId,role:'EMPLOYEE',active:true}}))fail(400,'Owner must be an active employee');const asset=await tx.asset.update({where:{id},data:{...data,version:{increment:1}},include:{owner:{select:person}}});await tx.event.create({data:{actorId:res.locals.user.id,action:'ASSET_UPDATED',detail:`Asset ${id}: ${JSON.stringify(data)}; previous owner ${before.ownerId}`,internal:true}});return asset;});res.json(asset);});
