-- CreateTable
CREATE TABLE "TrackEmbed" (
    "id" TEXT NOT NULL,
    "artistKey" TEXT NOT NULL,
    "titleKey" TEXT NOT NULL,
    "embedUrl" TEXT,
    "sourceUrl" TEXT,
    "source" TEXT,
    "coverUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackEmbed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrackEmbed_updatedAt_idx" ON "TrackEmbed"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackEmbed_artistKey_titleKey_key" ON "TrackEmbed"("artistKey", "titleKey");
