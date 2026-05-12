/*
  Warnings:

  - You are about to drop the `ArtistReleasesCache` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "ArtistReleasesCache";

-- CreateTable
CREATE TABLE "ArtistRelease" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "year" INTEGER,
    "type" TEXT,
    "role" TEXT,
    "format" TEXT,
    "label" TEXT,
    "thumb" TEXT,
    "resourceUrl" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtistRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArtistRelease_artistId_role_year_idx" ON "ArtistRelease"("artistId", "role", "year" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ArtistRelease_artistId_releaseId_key" ON "ArtistRelease"("artistId", "releaseId");
