-- DROP+recreate to switch from sourceUrl-keyed to (artistKey,titleKey)-keyed.
-- User explicitly accepted the loss of all existing rows (see ADR-0017):
-- migrating sourceUrl rows would require fetching artist/title for each row
-- and normalizing, which has no value relative to a clean rebuild as users
-- continue to dislike tracks.

-- DropTable
DROP TABLE "DislikedTrack";

-- CreateTable
CREATE TABLE "DislikedTrack" (
    "id" TEXT NOT NULL,
    "artistKey" TEXT NOT NULL,
    "titleKey" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DislikedTrack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DislikedTrack_artistKey_titleKey_key" ON "DislikedTrack"("artistKey", "titleKey");

-- CreateIndex
CREATE INDEX "DislikedTrack_artistKey_idx" ON "DislikedTrack"("artistKey");
