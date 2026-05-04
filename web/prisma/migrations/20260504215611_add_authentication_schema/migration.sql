-- Stage I — see ADR-0020 (forthcoming).
-- Hand-written: introduces required `userId` columns on Favorite and
-- DislikedTrack with backfill via the admin pre-create row, swaps
-- single-column unique constraints for compound ones, and creates the
-- Auth.js v5 adapter tables. `prisma migrate dev` cannot do this in
-- one step because of the NOT NULL backfill on existing rows.

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

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Pre-create admin row. Existing favorites/dislikes are backfilled to
-- this id; when the user registers with the same email the registration
-- flow "claims" the row by setting passwordHash + emailVerified. See
-- web/app/actions/register.ts and ADR-0020.
INSERT INTO "User" ("id", "email", "emailVerified", "passwordHash", "createdAt", "updatedAt")
VALUES (
    'admin_seed_account_id',
    'daebatzaebis@gmail.com',
    NULL,
    NULL,
    NOW(),
    NOW()
);

-- Favorite: swap trackId-unique for (userId, trackId)-unique, backfill userId.
ALTER TABLE "Favorite" ADD COLUMN "userId" TEXT;
UPDATE "Favorite" SET "userId" = 'admin_seed_account_id' WHERE "userId" IS NULL;
ALTER TABLE "Favorite" ALTER COLUMN "userId" SET NOT NULL;

DROP INDEX "Favorite_trackId_key";
CREATE UNIQUE INDEX "Favorite_userId_trackId_key" ON "Favorite"("userId", "trackId");
CREATE INDEX "Favorite_userId_idx" ON "Favorite"("userId");

ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DislikedTrack: same pattern, plus drop+recreate the artistKey index as compound.
ALTER TABLE "DislikedTrack" ADD COLUMN "userId" TEXT;
UPDATE "DislikedTrack" SET "userId" = 'admin_seed_account_id' WHERE "userId" IS NULL;
ALTER TABLE "DislikedTrack" ALTER COLUMN "userId" SET NOT NULL;

DROP INDEX "DislikedTrack_artistKey_titleKey_key";
CREATE UNIQUE INDEX "DislikedTrack_userId_artistKey_titleKey_key" ON "DislikedTrack"("userId", "artistKey", "titleKey");

DROP INDEX "DislikedTrack_artistKey_idx";
CREATE INDEX "DislikedTrack_userId_artistKey_idx" ON "DislikedTrack"("userId", "artistKey");

ALTER TABLE "DislikedTrack" ADD CONSTRAINT "DislikedTrack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
