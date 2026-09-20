-- Phase 4: article feedback.
--
-- Purely additive: one new table, no change to any existing table, column or constraint. An
-- article with no rows here simply has no verdict, which is how every existing article starts.
-- The unique (articleId, userId) pair is the whole integrity story: one person, one vote, changed
-- by updating their own row rather than by adding another.

-- CreateTable
CREATE TABLE "ArticleFeedback" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "helpful" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ArticleFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArticleFeedback_articleId_idx" ON "ArticleFeedback"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleFeedback_articleId_userId_key" ON "ArticleFeedback"("articleId", "userId");

-- AddForeignKey
ALTER TABLE "ArticleFeedback" ADD CONSTRAINT "ArticleFeedback_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleFeedback" ADD CONSTRAINT "ArticleFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
