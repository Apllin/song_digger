-- AlterTable
ALTER TABLE "ModelWeights" ADD COLUMN "bpmDeltaWeight" DOUBLE PRECISION;
ALTER TABLE "ModelWeights" ADD COLUMN "bpmCompatibleWeight" DOUBLE PRECISION;
ALTER TABLE "ModelWeights" ADD COLUMN "bpmPresentWeight" DOUBLE PRECISION;
ALTER TABLE "ModelWeights" ADD COLUMN "keyCompatibleWeight" DOUBLE PRECISION;
ALTER TABLE "ModelWeights" ADD COLUMN "keyPresentWeight" DOUBLE PRECISION;
