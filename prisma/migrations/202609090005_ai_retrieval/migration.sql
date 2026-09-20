-- Phase 3: AI assistance and permission-aware knowledge retrieval.
-- Purely additive. No existing table is dropped, no existing column is altered or rewritten,
-- and no row is deleted. An upgraded Phase 2 database keeps every ticket, reply, note, asset,
-- SLA record, article and outbox row exactly as it was.

-- Enable pgvector when the server provides it. The compose database image ships the extension;
-- a plain PostgreSQL image does not. Retrieval does not depend on it: ranking uses the exact
-- cosine function defined below over a permission-filtered candidate set, which is correct with
-- or without the extension.
--
-- Enabling the extension here does NOT make this table index-ready. "ArticleChunk"."embedding" is
-- double precision[], and pgvector's HNSW and IVFFlat index types require a column of type
-- `vector`. Adding an approximate index therefore needs a further migration that adds a vector
-- column (or converts this one), backfills it, and creates the index — see docs/RETRIEVAL.md for
-- the exact steps. The extension is enabled early only so that migration does not also have to
-- create it, which can require elevated privileges on a managed database.
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgvector not installed; retrieval will use the exact SQL cosine function';
END
$$;

-- CreateEnum
CREATE TYPE "AiOperation" AS ENUM ('TRIAGE', 'SUMMARY', 'DRAFT_REPLY', 'ANSWER', 'EMBED');

-- CreateEnum
CREATE TYPE "AiOutcome" AS ENUM ('OK', 'TIMEOUT', 'ERROR', 'REFUSED', 'INVALID_OUTPUT', 'RATE_LIMITED', 'INSUFFICIENT_EVIDENCE');

-- AlterTable: retrieval index bookkeeping. All nullable, so existing articles are simply "not indexed yet".
ALTER TABLE "Article" ADD COLUMN "indexedVersion" INTEGER;
ALTER TABLE "Article" ADD COLUMN "indexedModel" TEXT;
ALTER TABLE "Article" ADD COLUMN "indexedDimensions" INTEGER;
ALTER TABLE "Article" ADD COLUMN "indexedAt" TIMESTAMPTZ(3);
ALTER TABLE "Article" ADD COLUMN "indexError" TEXT;

-- CreateTable
CREATE TABLE "ArticleChunk" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "articleVersion" INTEGER NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "heading" TEXT,
    "content" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[],
    "embeddingModel" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "operation" "AiOperation" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "outcome" "AiOutcome" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArticleChunk_articleId_chunkIndex_embeddingModel_key" ON "ArticleChunk"("articleId", "chunkIndex", "embeddingModel");

-- CreateIndex
CREATE INDEX "ArticleChunk_embeddingModel_dimensions_idx" ON "ArticleChunk"("embeddingModel", "dimensions");

-- CreateIndex
CREATE INDEX "AiUsage_userId_createdAt_idx" ON "AiUsage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsage_createdAt_idx" ON "AiUsage"("createdAt");

-- AddForeignKey
ALTER TABLE "ArticleChunk" ADD CONSTRAINT "ArticleChunk_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exact cosine distance between two equal-length vectors, in the range [0, 2].
-- Returns NULL for a length mismatch so a query can never silently compare vectors produced by
-- different embedding models. IMMUTABLE + PARALLEL SAFE so PostgreSQL may evaluate it freely.
CREATE OR REPLACE FUNCTION opspilot_cosine_distance(a DOUBLE PRECISION[], b DOUBLE PRECISION[])
RETURNS DOUBLE PRECISION AS $$
    SELECT CASE
        WHEN array_length(a, 1) IS NULL
          OR array_length(b, 1) IS NULL
          OR array_length(a, 1) <> array_length(b, 1)
        THEN NULL
        ELSE 1 - (
            (SELECT COALESCE(sum(a[i] * b[i]), 0) FROM generate_subscripts(a, 1) AS g(i))
            / NULLIF(
                sqrt((SELECT COALESCE(sum(a[i] * a[i]), 0) FROM generate_subscripts(a, 1) AS g(i)))
                * sqrt((SELECT COALESCE(sum(b[i] * b[i]), 0) FROM generate_subscripts(b, 1) AS g(i))),
                0)
        )
    END
$$ LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE;
