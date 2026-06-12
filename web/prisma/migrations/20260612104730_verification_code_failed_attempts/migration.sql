-- AlterTable
ALTER TABLE "VerificationCode" ADD COLUMN     "failedAttempts" INTEGER NOT NULL DEFAULT 0;
