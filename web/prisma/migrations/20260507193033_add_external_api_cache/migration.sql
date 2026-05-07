-- CreateTable
CREATE TABLE "ExternalApiCache" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalApiCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalApiCache_source_updatedAt_idx" ON "ExternalApiCache"("source", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalApiCache_source_cacheKey_key" ON "ExternalApiCache"("source", "cacheKey");
