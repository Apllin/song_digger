/*
  Warnings:

  - You are about to drop the column `fetchedAt` on the `ArtistRelease` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ArtistRelease" DROP COLUMN "fetchedAt";

-- CreateTable
CREATE TABLE "ArtistReleasesMeta" (
    "artistId" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtistReleasesMeta_pkey" PRIMARY KEY ("artistId")
);
