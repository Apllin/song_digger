-- DropIndex
DROP INDEX "Track_bpm_idx";

-- AlterTable
ALTER TABLE "SearchQuery" DROP COLUMN "sourceBpm",
DROP COLUMN "sourceKey";
