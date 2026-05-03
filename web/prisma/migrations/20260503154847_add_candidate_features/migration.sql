-- CreateTable
CREATE TABLE "CandidateFeatures" (
    "id" TEXT NOT NULL,
    "searchQueryId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "bpmDelta" DOUBLE PRECISION,
    "keyCompat" DOUBLE PRECISION,
    "energyDelta" DOUBLE PRECISION,
    "labelMatch" DOUBLE PRECISION,
    "genreMatch" DOUBLE PRECISION,
    "nSources" INTEGER NOT NULL,
    "topRank" INTEGER NOT NULL,
    "hasEmbed" INTEGER NOT NULL,
    "rrfScore" DOUBLE PRECISION NOT NULL,
    "yearProximity" DOUBLE PRECISION,
    "artistCorelease" INTEGER,
    "cooccurrence1001tl" INTEGER,
    "cooccurrenceTrackid" INTEGER,
    "appearsInLastfm" INTEGER,
    "appearsInCosine" INTEGER,
    "appearsInYandex" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateFeatures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CandidateFeatures_searchQueryId_idx" ON "CandidateFeatures"("searchQueryId");

-- CreateIndex
CREATE INDEX "CandidateFeatures_trackId_idx" ON "CandidateFeatures"("trackId");

-- CreateIndex
CREATE INDEX "CandidateFeatures_createdAt_idx" ON "CandidateFeatures"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateFeatures_searchQueryId_trackId_key" ON "CandidateFeatures"("searchQueryId", "trackId");

-- AddForeignKey
ALTER TABLE "CandidateFeatures" ADD CONSTRAINT "CandidateFeatures_searchQueryId_fkey" FOREIGN KEY ("searchQueryId") REFERENCES "SearchQuery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateFeatures" ADD CONSTRAINT "CandidateFeatures_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
