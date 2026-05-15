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
    sourceWeights: Object.fromEntries(row.sourceWeights.map((sw) => [sw.source, sw.weight])),
  };
}
