-- AlterTable
ALTER TABLE "ModelWeights" ADD COLUMN     "bpmRangeAdjustments" JSONB,
ADD COLUMN     "genreAdjustments" JSONB;

-- AlterTable
ALTER TABLE "SearchQuery" ADD COLUMN     "seedGenre" TEXT;
