import {Router} from 'express';
import {z} from 'zod';
import {marked} from 'marked';
import sanitizeHtml from 'sanitize-html';
import {db} from './db.js';
import {admin,fail,idOf,person} from './http.js';
import {pageSchema} from '../shared/operations.js';
import type {CurrentUser} from '../shared/model.js';
import type {Prisma} from '../generated/prisma/client.js';
import {invalidate} from './ai/retrieval.js';
export const articleSchema=z.object({title:z.string().trim().min(5).max(160),markdown:z.string().trim().min(10).max(20000),categoryId:z.uuid(),visibility:z.enum(['EMPLOYEE','SUPPORT']),status:z.enum(['DRAFT','PUBLISHED','ARCHIVED'])}).strict();
export function articleScope(user:CurrentUser):Prisma.ArticleWhereInput{return user.role==='ADMIN'?{}:{status:'PUBLISHED',...(user.role==='EMPLOYEE'?{visibility:'EMPLOYEE'}:{})};}
export function renderMarkdown(markdown:string){return sanitizeHtml(marked.parse(markdown,{async:false}),{allowedTags:['h1','h2','h3','h4','p','br','strong','em','del','blockquote','pre','code','ul','ol','li','a','hr','table','thead','tbody','tr','th','td'],allowedAttributes:{a:['href','title','rel']},allowedSchemes:['http','https'],allowProtocolRelative:false,transformTags:{a:sanitizeHtml.simpleTransform('a',{rel:'noopener noreferrer'})}});}
const include={category:true,author:{select:person}} as const;
export const knowledgeRouter=Router();
knowledgeRouter.get('/articles',async(req,res)=>{const f=pageSchema.extend({categoryId:z.uuid().optional(),status:z.enum(['DRAFT','PUBLISHED','ARCHIVED']).optional()}).parse(req.query);const where:Prisma.ArticleWhereInput={AND:[articleScope(res.locals.user),{...(f.categoryId?{categoryId:f.categoryId}:{}),...(f.status?{status:f.status}:{}),...(f.q?{OR:[{title:{contains:f.q,mode:'insensitive'}},{markdown:{contains:f.q,mode:'insensitive'}}]}:{})}]};const [items,total]=await db.$transaction([db.article.findMany({where,select:{id:true,title:true,visibility:true,status:true,category:true,updatedAt:true,version:true},orderBy:[{updatedAt:'desc'},{id:'asc'}],skip:(f.page-1)*f.pageSize,take:f.pageSize}),db.article.count({where})],{isolationLevel:'RepeatableRead'});res.json({items,total,page:f.page,pageSize:f.pageSize});});
knowledgeRouter.get('/articles/:id',async(req,res)=>{
 const me=res.locals.user;
 const a=await db.article.findFirst({where:{AND:[{id:idOf(req)},articleScope(me)]},include});
 if(!a)fail(404,'Article not found');
 res.json({...a,html:renderMarkdown(a.markdown),feedback:await feedbackFor(a.id,me.id)});
});
/** Counts plus the caller's own vote. An article nobody has voted on reports zeroes, never a score. */
async function feedbackFor(articleId:string,userId:string){
 const [helpful,notHelpful,mine]=await Promise.all([
  db.articleFeedback.count({where:{articleId,helpful:true}}),
  db.articleFeedback.count({where:{articleId,helpful:false}}),
  db.articleFeedback.findUnique({where:{articleId_userId:{articleId,userId}},select:{helpful:true}}),
 ]);
 return {helpful,notHelpful,mine:mine?mine.helpful:null};
}
/**
 * One verdict per person per article, changeable. The article scope decides who may vote, so a
 * support-only runbook cannot be rated — or counted — by someone who may not read it.
 */
knowledgeRouter.post('/articles/:id/feedback',async(req,res)=>{
 const {helpful}=z.object({helpful:z.boolean()}).strict().parse(req.body);
 const me=res.locals.user;
 const id=idOf(req);
 if(!await db.article.findFirst({where:{AND:[{id},articleScope(me)]},select:{id:true}}))fail(404,'Article not found');
 await db.articleFeedback.upsert({where:{articleId_userId:{articleId:id,userId:me.id}},update:{helpful},create:{articleId:id,userId:me.id,helpful}});
 res.json(await feedbackFor(id,me.id));
});
/**
 * Knowledge home aggregates, computed under the caller's own visibility: category counts, what
 * changed recently, and what people actually found helpful. Returning counts rather than rows is
 * the point — the home page must not depend on downloading the article table.
 */
knowledgeRouter.get('/knowledge/overview',async(req,res)=>{
 const me=res.locals.user;
 const scope=articleScope(me);
 const [categories,grouped,recent,votes]=await Promise.all([
  db.category.findMany({orderBy:{name:'asc'},select:{id:true,name:true}}),
  db.article.groupBy({by:['categoryId'],where:scope,_count:{_all:true}}),
  db.article.findMany({where:scope,select:{id:true,title:true,visibility:true,status:true,updatedAt:true,category:{select:{id:true,name:true}}},orderBy:[{updatedAt:'desc'},{id:'asc'}],take:6}),
  db.articleFeedback.groupBy({by:['articleId'],where:{helpful:true,article:scope},_count:{_all:true},orderBy:{_count:{articleId:'desc'}},take:5}),
 ]);
 const counts=new Map(grouped.map(g=>[g.categoryId,g._count._all]));
 const helpfulArticles=votes.length
  ? await db.article.findMany({where:{AND:[{id:{in:votes.map(v=>v.articleId)}},scope]},select:{id:true,title:true,visibility:true,status:true,updatedAt:true,category:{select:{id:true,name:true}}}})
  : [];
 const byVotes=new Map(votes.map(v=>[v.articleId,v._count._all]));
 res.json({
  total:grouped.reduce((n,g)=>n+g._count._all,0),
  categories:categories.map(c=>({...c,articles:counts.get(c.id)??0})).filter(c=>c.articles>0),
  recent,
  helpful:helpfulArticles.map(a=>({...a,helpfulVotes:byVotes.get(a.id)??0})).sort((a,b)=>b.helpfulVotes-a.helpfulVotes),
 });
});
knowledgeRouter.post('/articles',admin,async(req,res)=>{const data=articleSchema.parse(req.body);if(!await db.category.findUnique({where:{id:data.categoryId}}))fail(400,'Unknown category');const a=await db.$transaction(async tx=>{const a=await tx.article.create({data:{...data,authorId:res.locals.user.id,publishedAt:data.status==='PUBLISHED'?new Date():null,archivedAt:data.status==='ARCHIVED'?new Date():null},include});await tx.event.create({data:{actorId:res.locals.user.id,action:'ARTICLE_CREATED',detail:`Article ${a.id} ${a.status} ${a.visibility}`,internal:true}});return a;});res.status(201).json({...a,html:renderMarkdown(a.markdown)});});
knowledgeRouter.put('/articles/:id',admin,async(req,res)=>{const {version,article:data}=z.object({version:z.number().int().nonnegative(),article:articleSchema}).strict().parse(req.body);const id=idOf(req);const a=await db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Article" WHERE id=${id} FOR UPDATE`;const before=await tx.article.findUnique({where:{id}});if(!before)fail(404,'Article not found');if(before.version!==version)fail(409,'Article changed. Refresh and try again.');if(!await tx.category.findUnique({where:{id:data.categoryId}}))fail(400,'Unknown category');const a=await tx.article.update({where:{id},data:{...data,version:{increment:1},publishedAt:data.status==='PUBLISHED'&&before.status!=='PUBLISHED'?new Date():before.publishedAt,archivedAt:data.status==='ARCHIVED'?new Date():null},include});await invalidate(tx,id);await tx.event.create({data:{actorId:res.locals.user.id,action:'ARTICLE_UPDATED',detail:`Article ${id}: ${before.status}/${before.visibility} → ${a.status}/${a.visibility}; version ${a.version}`,internal:true}});return a;});res.json({...a,html:renderMarkdown(a.markdown)});});
