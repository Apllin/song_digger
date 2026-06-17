-- AlterTable
ALTER TABLE "SearchResult" ADD COLUMN "rank" INTEGER NOT NULL DEFAULT 0;

-- DropIndex
DROP INDEX "SearchResult_searchQueryId_idx";

-- CreateIndex
CREATE INDEX "SearchResult_searchQueryId_rank_idx" ON "SearchResult"("searchQueryId", "rank");
