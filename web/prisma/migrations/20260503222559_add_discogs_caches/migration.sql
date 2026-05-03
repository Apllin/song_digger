-- CreateTable
CREATE TABLE "ArtistDiscography" (
    "id" TEXT NOT NULL,
    "artistName" TEXT NOT NULL,
    "discogsArtistId" TEXT,
    "releases" JSONB NOT NULL,
    "debutYear" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtistDiscography_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtistCollaborations" (
    "id" TEXT NOT NULL,
    "artistName" TEXT NOT NULL,
    "collaborators" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtistCollaborations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArtistDiscography_artistName_key" ON "ArtistDiscography"("artistName");

-- CreateIndex
CREATE INDEX "ArtistDiscography_updatedAt_idx" ON "ArtistDiscography"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArtistCollaborations_artistName_key" ON "ArtistCollaborations"("artistName");

-- CreateIndex
CREATE INDEX "ArtistCollaborations_updatedAt_idx" ON "ArtistCollaborations"("updatedAt");
