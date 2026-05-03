-- CreateTable
CREATE TABLE "TracklistCooccurrence" (
    "id" TEXT NOT NULL,
    "seedTracklistId" TEXT NOT NULL,
    "pairTracklistId" TEXT NOT NULL,
    "pairArtist" TEXT NOT NULL,
    "pairTitle" TEXT NOT NULL,
    "setCount" INTEGER NOT NULL DEFAULT 1,
    "pairUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TracklistCooccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TracklistCooccurrence_seedTracklistId_idx" ON "TracklistCooccurrence"("seedTracklistId");

-- CreateIndex
CREATE INDEX "TracklistCooccurrence_updatedAt_idx" ON "TracklistCooccurrence"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TracklistCooccurrence_seedTracklistId_pairTracklistId_key" ON "TracklistCooccurrence"("seedTracklistId", "pairTracklistId");
