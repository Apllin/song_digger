/*
  Warnings:

  - You are about to drop the column `cooccurrence1001tl` on the `CandidateFeatures` table. All the data in the column will be lost.
  - You are about to drop the `TracklistCooccurrence` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "CandidateFeatures" DROP COLUMN "cooccurrence1001tl";

-- DropTable
DROP TABLE "TracklistCooccurrence";
