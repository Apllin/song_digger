-- CreateTable
CREATE TABLE "Track" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "coverUrl" TEXT,
    "embedUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "passwordHash" TEXT,
    "name" TEXT,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationCode" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchQuery" (
    "id" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "cacheKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchResult" (
    "id" TEXT NOT NULL,
    "searchQueryId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "sources" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "SearchResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DislikedTrack" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "artistKey" TEXT NOT NULL,
    "titleKey" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DislikedTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnonymousRequest" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnonymousRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "email" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "ExternalApiCache" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalApiCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestMetric" (
    "id" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "cpuMs" INTEGER NOT NULL,
    "responseBytes" INTEGER NOT NULL DEFAULT 0,
    "pythonDurationMs" INTEGER,
    "cacheHit" BOOLEAN,
    "sourcesUsed" JSONB,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtistReleasesMeta" (
    "artistId" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtistReleasesMeta_pkey" PRIMARY KEY ("artistId")
);

-- CreateTable
CREATE TABLE "ArtistRelease" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT,
    "year" INTEGER,
    "type" TEXT,
    "role" TEXT,
    "format" TEXT,
    "label" TEXT,
    "thumb" TEXT,
    "resourceUrl" TEXT,

    CONSTRAINT "ArtistRelease_pkey" PRIMARY KEY ("id")
);

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
CREATE UNIQUE INDEX "Track_sourceUrl_key" ON "Track"("sourceUrl");

-- CreateIndex
CREATE INDEX "Track_source_idx" ON "Track"("source");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "VerificationCode_email_idx" ON "VerificationCode"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "PasswordResetToken_email_idx" ON "PasswordResetToken"("email");

-- CreateIndex
CREATE INDEX "SearchQuery_cacheKey_status_createdAt_idx" ON "SearchQuery"("cacheKey", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SearchResult_searchQueryId_idx" ON "SearchResult"("searchQueryId");

-- CreateIndex
CREATE UNIQUE INDEX "SearchResult_searchQueryId_trackId_key" ON "SearchResult"("searchQueryId", "trackId");

-- CreateIndex
CREATE INDEX "Favorite_userId_idx" ON "Favorite"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_userId_trackId_key" ON "Favorite"("userId", "trackId");

-- CreateIndex
CREATE INDEX "DislikedTrack_userId_artistKey_idx" ON "DislikedTrack"("userId", "artistKey");

-- CreateIndex
CREATE UNIQUE INDEX "DislikedTrack_userId_artistKey_titleKey_key" ON "DislikedTrack"("userId", "artistKey", "titleKey");

-- CreateIndex
CREATE UNIQUE INDEX "AnonymousRequest_ip_key" ON "AnonymousRequest"("ip");

-- CreateIndex
CREATE INDEX "LoginAttempt_ip_createdAt_idx" ON "LoginAttempt"("ip", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_email_createdAt_idx" ON "LoginAttempt"("email", "createdAt");

-- CreateIndex
CREATE INDEX "TrackEmbed_updatedAt_idx" ON "TrackEmbed"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackEmbed_artistKey_titleKey_key" ON "TrackEmbed"("artistKey", "titleKey");

-- CreateIndex
CREATE INDEX "ExternalApiCache_source_updatedAt_idx" ON "ExternalApiCache"("source", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalApiCache_source_cacheKey_key" ON "ExternalApiCache"("source", "cacheKey");

-- CreateIndex
CREATE INDEX "RequestMetric_route_createdAt_idx" ON "RequestMetric"("route", "createdAt");

-- CreateIndex
CREATE INDEX "RequestMetric_createdAt_idx" ON "RequestMetric"("createdAt");

-- CreateIndex
CREATE INDEX "ArtistRelease_artistId_role_year_idx" ON "ArtistRelease"("artistId", "role", "year" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ArtistRelease_artistId_releaseId_key" ON "ArtistRelease"("artistId", "releaseId");

-- CreateIndex
CREATE UNIQUE INDEX "LastfmArtistSimilars_seedArtist_key" ON "LastfmArtistSimilars"("seedArtist");

-- CreateIndex
CREATE INDEX "LastfmArtistSimilars_updatedAt_idx" ON "LastfmArtistSimilars"("updatedAt");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchResult" ADD CONSTRAINT "SearchResult_searchQueryId_fkey" FOREIGN KEY ("searchQueryId") REFERENCES "SearchQuery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchResult" ADD CONSTRAINT "SearchResult_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DislikedTrack" ADD CONSTRAINT "DislikedTrack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
