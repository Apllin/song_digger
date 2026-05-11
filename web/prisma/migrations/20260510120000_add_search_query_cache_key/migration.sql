-- AlterTable
ALTER TABLE "SearchQuery" ADD COLUMN "cacheKey" TEXT;

-- CreateIndex
CREATE INDEX "SearchQuery_cacheKey_status_createdAt_idx" ON "SearchQuery"("cacheKey", "status", "createdAt");
