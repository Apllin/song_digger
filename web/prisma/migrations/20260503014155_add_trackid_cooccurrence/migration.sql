-- CreateTable
CREATE TABLE "TrackidCooccurrence" (
    "id" TEXT NOT NULL,
    "seedTrackidId" TEXT NOT NULL,
    "pairTrackidId" TEXT NOT NULL,
    "pairArtist" TEXT NOT NULL,
    "pairTitle" TEXT NOT NULL,
    "setCount" INTEGER NOT NULL DEFAULT 1,
    "pairUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackidCooccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrackidCooccurrence_seedTrackidId_idx" ON "TrackidCooccurrence"("seedTrackidId");

-- CreateIndex
CREATE INDEX "TrackidCooccurrence_updatedAt_idx" ON "TrackidCooccurrence"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackidCooccurrence_seedTrackidId_pairTrackidId_key" ON "TrackidCooccurrence"("seedTrackidId", "pairTrackidId");
