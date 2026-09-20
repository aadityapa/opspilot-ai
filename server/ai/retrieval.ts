import { db } from '../db.js';
import { config } from '../config.js';
import { provider as defaultProvider, type AiProvider } from './provider.js';
import { meter } from './usage.js';
import type { CurrentUser } from '../../shared/model.js';
import type { Prisma } from '../../generated/prisma/client.js';

/**
 * Permission-aware knowledge retrieval.
 *
 * The security property that matters here is that visibility is part of the candidate selection,
 * not a filter applied to the model's answer. A restricted passage is never embedded into a prompt
 * in the first place, so there is nothing for the model to leak and nothing to rely on it to hide.
 *
 * Ranking uses the exact cosine distance function installed by the Phase 3 migration, evaluated
 * over the permission-filtered candidate set. Exact ranking is a deliberate choice at this scale,
 * not a placeholder: it returns the true nearest passages, has no index to rebuild when content
 * changes, and runs on a plain PostgreSQL server. docs/RETRIEVAL.md records the measured latency.
 *
 * pgvector is enabled by the same migration when available, but this table is NOT index-ready:
 * `embedding` is double precision[], and pgvector indexes require a `vector` column. Moving to an
 * approximate index would need a further migration — docs/RETRIEVAL.md sets out what that involves.
 */

export interface Chunk {
  id: string;
  articleId: string;
  articleTitle: string;
  chunkIndex: number;
  heading: string | null;
  content: string;
  similarity: number;
}

/** Retrieval scope. Stricter than the browsing scope: drafts and archived articles never qualify. */
export function retrievalScope(user: CurrentUser): Prisma.ArticleWhereInput {
  return {
    status: 'PUBLISHED',
    ...(user.role === 'EMPLOYEE' ? { visibility: 'EMPLOYEE' as const } : {}),
  };
}

/**
 * Splits an article into overlapping passages that follow Markdown headings where possible, so a
 * citation points at something a reader can recognise on the article page.
 */
export function chunkArticle(markdown: string, maxChars = 1100, overlap = 150): { heading: string | null; content: string }[] {
  const lines = markdown.split('\n');
  const sections: { heading: string | null; body: string[] }[] = [{ heading: null, body: [] }];
  for (const line of lines) {
    const match = /^#{1,4}\s+(.*)$/.exec(line.trim());
    if (match) sections.push({ heading: match[1].trim().slice(0, 200), body: [] });
    else sections[sections.length - 1].body.push(line);
  }
  const chunks: { heading: string | null; content: string }[] = [];
  for (const section of sections) {
    const text = section.body.join('\n').trim();
    if (!text) continue;
    if (text.length <= maxChars) {
      chunks.push({ heading: section.heading, content: text });
      continue;
    }
    // Split long sections on paragraph boundaries, carrying a little overlap for continuity.
    // A single paragraph longer than the limit is hard-split rather than kept whole, so an article
    // written as one long block is still indexed instead of producing one unusable passage.
    const paragraphs = text.split(/\n{2,}/).flatMap((paragraph) => {
      if (paragraph.length <= maxChars) return [paragraph];
      const parts: string[] = [];
      for (let start = 0; start < paragraph.length; start += maxChars - overlap)
        parts.push(paragraph.slice(start, start + maxChars));
      return parts;
    });
    let buffer = '';
    for (const paragraph of paragraphs) {
      if (buffer && buffer.length + paragraph.length + 2 > maxChars) {
        chunks.push({ heading: section.heading, content: buffer.trim() });
        buffer = `${buffer.slice(-overlap)}\n\n${paragraph}`;
      } else {
        buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
      }
    }
    if (buffer.trim()) chunks.push({ heading: section.heading, content: buffer.trim() });
  }
  return chunks.filter((c) => c.content.replace(/\s/g, '').length > 20).slice(0, 50);
}

export type IndexState = 'NOT_INDEXED' | 'INDEXED' | 'STALE_CONTENT' | 'STALE_MODEL' | 'NOT_ELIGIBLE' | 'FAILED';

export interface ArticleIndexStatus {
  id: string;
  title: string;
  status: string;
  visibility: string;
  version: number;
  indexedVersion: number | null;
  indexedModel: string | null;
  indexedAt: Date | null;
  indexError: string | null;
  chunks: number;
  state: IndexState;
}

/** Derives index state from stored columns; nothing is cached, so it cannot drift. */
export function indexState(
  article: { status: string; version: number; indexedVersion: number | null; indexedModel: string | null; indexError: string | null },
  currentModel: string,
): IndexState {
  if (article.status !== 'PUBLISHED') return 'NOT_ELIGIBLE';
  if (article.indexError) return 'FAILED';
  if (article.indexedVersion === null) return 'NOT_INDEXED';
  if (article.indexedModel !== currentModel) return 'STALE_MODEL';
  if (article.indexedVersion !== article.version) return 'STALE_CONTENT';
  return 'INDEXED';
}

/**
 * Removes every chunk for an article. Called whenever an article changes in any way that could
 * affect what may be retrieved — content, visibility or status. Deleting rather than marking is
 * deliberate: the index fails closed, so a stale or newly-restricted passage cannot be served
 * while a reindex is pending.
 */
export async function invalidate(tx: Prisma.TransactionClient, articleId: string): Promise<void> {
  await tx.articleChunk.deleteMany({ where: { articleId } });
  await clearIndexState(tx, articleId, null);
}

/**
 * Index bookkeeping is written with raw SQL on purpose. These columns say what the retrieval index
 * knows; they are not an edit of the article. Writing them through Prisma would touch `updatedAt`,
 * which means "when the guidance last changed" — reindexing a hundred unchanged articles would
 * then reorder "recently updated" and make a real edit indistinguishable from a maintenance run.
 */
async function clearIndexState(tx: Prisma.TransactionClient, articleId: string, error: string | null): Promise<void> {
  await tx.$executeRaw`UPDATE "Article" SET "indexedVersion" = NULL, "indexedModel" = NULL, "indexedDimensions" = NULL, "indexedAt" = NULL, "indexError" = ${error} WHERE id = ${articleId}`;
}

export interface IndexReport {
  articleId: string;
  title: string;
  state: IndexState;
  chunks: number;
  error?: string;
}

/** Indexes one article. Published only; anything else has its chunks removed instead. */
export async function indexArticle(
  articleId: string,
  actorId: string,
  active: AiProvider = defaultProvider,
): Promise<IndexReport> {
  const article = await db.article.findUniqueOrThrow({ where: { id: articleId } });
  if (article.status !== 'PUBLISHED') {
    await db.$transaction(async (tx) => invalidate(tx, articleId));
    return { articleId, title: article.title, state: 'NOT_ELIGIBLE', chunks: 0 };
  }
  const pieces = chunkArticle(article.markdown);
  if (!pieces.length) {
    await db.$transaction(async (tx) => invalidate(tx, articleId));
    return { articleId, title: article.title, state: 'NOT_INDEXED', chunks: 0 };
  }
  const versionAtRead = article.version;
  try {
    const vectors = await meter(
      { userId: actorId, operation: 'EMBED', provider: active },
      async (p) => {
        const result = await p.embed(pieces.map((c) => `${article.title}\n${c.heading ?? ''}\n${c.content}`));
        return { value: result, usage: result.usage, model: result.model };
      },
    );
    if (vectors.vectors.length !== pieces.length) throw new Error('Embedding count mismatch');
    await db.$transaction(async (tx) => {
      // Re-read under the transaction: if the article changed while we were embedding, discard the
      // result rather than storing chunks that describe superseded text.
      const current = await tx.article.findUniqueOrThrow({ where: { id: articleId } });
      if (current.version !== versionAtRead || current.status !== 'PUBLISHED') return;
      await tx.articleChunk.deleteMany({ where: { articleId } });
      await tx.articleChunk.createMany({
        data: pieces.map((piece, index) => ({
          articleId,
          articleVersion: versionAtRead,
          chunkIndex: index,
          heading: piece.heading,
          content: piece.content,
          embedding: vectors.vectors[index],
          embeddingModel: vectors.model,
          dimensions: vectors.dimensions,
        })),
      });
      await tx.$executeRaw`UPDATE "Article" SET "indexedVersion" = ${versionAtRead}, "indexedModel" = ${vectors.model}, "indexedDimensions" = ${vectors.dimensions}, "indexedAt" = ${new Date()}, "indexError" = NULL WHERE id = ${articleId}`;
    });
    return { articleId, title: article.title, state: 'INDEXED', chunks: pieces.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Indexing failed';
    await db.$transaction(async (tx) => {
      await tx.articleChunk.deleteMany({ where: { articleId } });
      await clearIndexState(tx, articleId, message.slice(0, 300));
    });
    return { articleId, title: article.title, state: 'FAILED', chunks: 0, error: message.slice(0, 300) };
  }
}

/** Indexes every published article that is not currently indexed with the active model. */
export async function reindexAll(actorId: string, active: AiProvider = defaultProvider): Promise<IndexReport[]> {
  const articles = await db.article.findMany({ where: { status: 'PUBLISHED' }, orderBy: { updatedAt: 'asc' } });
  const reports: IndexReport[] = [];
  for (const article of articles) {
    const state = indexState(article, active.embeddingModel);
    if (state === 'INDEXED') {
      reports.push({ articleId: article.id, title: article.title, state, chunks: await db.articleChunk.count({ where: { articleId: article.id } }) });
      continue;
    }
    reports.push(await indexArticle(article.id, actorId, active));
  }
  // Chunks written by a previous embedding model can never be compared against current vectors,
  // so they are removed outright rather than left to accumulate.
  await db.articleChunk.deleteMany({
    where: { OR: [{ embeddingModel: { not: active.embeddingModel } }, { dimensions: { not: active.dimensions } }] },
  });
  return reports;
}

/**
 * Finds the closest passages the caller is allowed to read.
 *
 * The visibility and status conditions, the embedding-model match and the dimension match are all
 * inside the same SQL statement that ranks and limits, so an ineligible chunk is never a candidate.
 */
export async function search(user: CurrentUser, queryVector: number[], active: AiProvider, topK: number): Promise<Chunk[]> {
  const employeeOnly = user.role === 'EMPLOYEE';
  // The distance is computed once per candidate, in a LATERAL, and the null check reads that one
  // result. Calling the function in both the WHERE and the SELECT — as this query first did —
  // evaluated it twice per row and doubled the cost of every search.
  const rows = await db.$queryRaw<
    { id: string; articleId: string; articleTitle: string; chunkIndex: number; heading: string | null; content: string; distance: number | null }[]
  >`
    SELECT c.id,
           c."articleId",
           a.title AS "articleTitle",
           c."chunkIndex",
           c.heading,
           c.content,
           d.distance
      FROM "ArticleChunk" c
      JOIN "Article" a ON a.id = c."articleId"
     CROSS JOIN LATERAL (
            SELECT opspilot_cosine_distance(c.embedding, ${queryVector}::double precision[]) AS distance
          ) d
     WHERE a.status = 'PUBLISHED'
       AND (${employeeOnly}::boolean = false OR a.visibility = 'EMPLOYEE')
       AND c."embeddingModel" = ${active.embeddingModel}
       AND c.dimensions = ${active.dimensions}
       AND c."articleVersion" = a.version
       AND d.distance IS NOT NULL
     ORDER BY d.distance ASC, c."articleId" ASC, c."chunkIndex" ASC
     LIMIT ${topK}
  `;
  const ranked = rows
    .filter((row) => row.distance !== null)
    .map((row) => ({
      id: row.id,
      articleId: row.articleId,
      articleTitle: row.articleTitle,
      chunkIndex: row.chunkIndex,
      heading: row.heading,
      content: row.content,
      similarity: 1 - (row.distance ?? 1),
    }));
  // Two cutoffs, because one fixed number cannot serve two embedding spaces. The absolute floor
  // rejects a question no article is about at all. The relative floor keeps only passages close to
  // the best match, so a weakly related article is not passed off as evidence. Cosine similarity
  // scales differently for the mock hashing embedding and for a real embedding model, which is why
  // the floor is configurable rather than hard-coded.
  const best = ranked[0]?.similarity ?? 0;
  if (best < config.AI_MIN_SIMILARITY) return [];
  return ranked.filter((chunk) => chunk.similarity >= Math.max(config.AI_MIN_SIMILARITY, best * RELATIVE_FLOOR));
}
export const RELATIVE_FLOOR = 0.45;

/**
 * Re-checks that specific chunks are still retrievable by this caller, immediately before an answer
 * is returned. An article archived, unpublished or restricted between retrieval and response must
 * not appear as a citation, so this runs against current rows rather than the earlier snapshot.
 */
export async function stillVisible(user: CurrentUser, chunkIds: string[]): Promise<Set<string>> {
  if (!chunkIds.length) return new Set();
  const rows = await db.articleChunk.findMany({
    where: { id: { in: chunkIds }, article: retrievalScope(user) },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}
