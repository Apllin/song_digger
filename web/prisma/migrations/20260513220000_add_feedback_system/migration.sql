-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'TRAINER');

-- CreateEnum
CREATE TYPE "SimilaritySource" AS ENUM ('cosine_club', 'youtube_music', 'yandex_music', 'lastfm', 'trackidnet', 'soundcloud');

-- AlterTable
ALTER TABLE "SearchResult" ADD COLUMN "features" JSONB;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'USER';

-- CreateTable
CREATE TABLE "SimilarityFeedback" (
    "id" TEXT NOT NULL,
    "isSimilar" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "searchQueryId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,

    CONSTRAINT "SimilarityFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelWeights" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "trainedAt" TIMESTAMP(3) NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "rankDecayK" DOUBLE PRECISION NOT NULL,
    "cosineScoreWeight" DOUBLE PRECISION NOT NULL,
    "numSourcesWeight" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ModelWeights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceWeight" (
    "id" TEXT NOT NULL,
    "source" "SimilaritySource" NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "modelWeightsId" TEXT NOT NULL,

    CONSTRAINT "SourceWeight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SimilarityFeedback_userId_idx" ON "SimilarityFeedback"("userId");

-- CreateIndex
CREATE INDEX "SimilarityFeedback_searchQueryId_idx" ON "SimilarityFeedback"("searchQueryId");

-- CreateIndex
CREATE UNIQUE INDEX "SimilarityFeedback_userId_searchQueryId_trackId_key" ON "SimilarityFeedback"("userId", "searchQueryId", "trackId");

-- CreateIndex
CREATE UNIQUE INDEX "ModelWeights_version_key" ON "ModelWeights"("version");

-- CreateIndex
CREATE UNIQUE INDEX "SourceWeight_modelWeightsId_source_key" ON "SourceWeight"("modelWeightsId", "source");

-- AddForeignKey
ALTER TABLE "SimilarityFeedback" ADD CONSTRAINT "SimilarityFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimilarityFeedback" ADD CONSTRAINT "SimilarityFeedback_searchQueryId_fkey" FOREIGN KEY ("searchQueryId") REFERENCES "SearchQuery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimilarityFeedback" ADD CONSTRAINT "SimilarityFeedback_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceWeight" ADD CONSTRAINT "SourceWeight_modelWeightsId_fkey" FOREIGN KEY ("modelWeightsId") REFERENCES "ModelWeights"("id") ON DELETE CASCADE ON UPDATE CASCADE;
