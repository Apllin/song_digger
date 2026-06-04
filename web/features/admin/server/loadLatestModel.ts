import { prisma } from "@/lib/prisma";

export type LatestModelSnapshot = {
  version: number;
  trainedAt: Date;
  sampleSize: number;
  rankDecayK: number;
  cosineScoreWeight: number;
  numSourcesWeight: number;
  bpmDeltaWeight: number | null;
  bpmCompatibleWeight: number | null;
  bpmPresentWeight: number | null;
  keyCompatibleWeight: number | null;
  keyPresentWeight: number | null;
  sourceWeights: Record<string, number>;
};

export async function loadLatestModel(): Promise<LatestModelSnapshot | null> {
  const row = await prisma.modelWeights.findFirst({
    orderBy: { version: "desc" },
    include: { sourceWeights: true },
  });
  if (!row) return null;
  return {
    version: row.version,
    trainedAt: row.trainedAt,
    sampleSize: row.sampleSize,
    rankDecayK: row.rankDecayK,
    cosineScoreWeight: row.cosineScoreWeight,
    numSourcesWeight: row.numSourcesWeight,
    bpmDeltaWeight: row.bpmDeltaWeight,
    bpmCompatibleWeight: row.bpmCompatibleWeight,
    bpmPresentWeight: row.bpmPresentWeight,
    keyCompatibleWeight: row.keyCompatibleWeight,
    keyPresentWeight: row.keyPresentWeight,
    sourceWeights: Object.fromEntries(row.sourceWeights.map((sw) => [sw.source, sw.weight])),
  };
}

export async function countLabeledSamples(): Promise<number> {
  return prisma.similarityFeedback.count();
}
