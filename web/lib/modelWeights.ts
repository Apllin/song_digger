import type { WeightConfig } from "@/lib/aggregator";
import { DEFAULT_WEIGHTS } from "@/lib/aggregator";
import { prisma } from "@/lib/prisma";

export async function getActiveWeights(): Promise<WeightConfig> {
  const row = await prisma.modelWeights.findFirst({
    orderBy: { version: "desc" },
    include: { sourceWeights: true },
  });
  if (!row) return DEFAULT_WEIGHTS;
  return {
    rankDecayK: row.rankDecayK,
    cosineScoreWeight: row.cosineScoreWeight,
    numSourcesWeight: row.numSourcesWeight,
    bpmDeltaWeight: row.bpmDeltaWeight ?? 0,
    bpmCompatibleWeight: row.bpmCompatibleWeight ?? 0,
    bpmPresentWeight: row.bpmPresentWeight ?? 0,
    keyCompatibleWeight: row.keyCompatibleWeight ?? 0,
    keyPresentWeight: row.keyPresentWeight ?? 0,
    sourceWeights: Object.fromEntries(row.sourceWeights.map((sw) => [sw.source, sw.weight])),
  };
}
