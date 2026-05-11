-- CreateTable
CREATE TABLE "RequestMetric" (
    "id" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "cpuMs" INTEGER NOT NULL,
    "responseBytes" INTEGER NOT NULL DEFAULT 0,
    "pythonDurationMs" INTEGER,
    "cacheHit" BOOLEAN,
    "sourcesUsed" JSONB,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequestMetric_route_createdAt_idx" ON "RequestMetric"("route", "createdAt");

-- CreateIndex
CREATE INDEX "RequestMetric_createdAt_idx" ON "RequestMetric"("createdAt");
