-- CreateTable
CREATE TABLE "LastfmArtistSimilars" (
    "id" TEXT NOT NULL,
    "seedArtist" TEXT NOT NULL,
    "similars" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LastfmArtistSimilars_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LastfmArtistSimilars_seedArtist_key" ON "LastfmArtistSimilars"("seedArtist");

-- CreateIndex
CREATE INDEX "LastfmArtistSimilars_updatedAt_idx" ON "LastfmArtistSimilars"("updatedAt");
