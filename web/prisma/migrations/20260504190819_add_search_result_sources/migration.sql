-- AlterTable
ALTER TABLE "SearchResult" ADD COLUMN     "sources" TEXT[] DEFAULT ARRAY[]::TEXT[];
