import { Hono } from "hono";

import { TrackFeaturesSchema } from "@/lib/aggregator";
import { requireTrainer } from "@/lib/auth-utils";
import type { AppEnv } from "@/lib/hono/types";
import { prisma } from "@/lib/prisma";
import { trainWeights } from "@/lib/python-api/generated/clients/trainWeights";

const MIN_SAMPLES = 20;

export const trainApi = new Hono<AppEnv>().post("/admin/train", async (c) => {
  const user = await requireTrainer().catch(() => null);
  if (!user) return c.json({ error: "Forbidden" } as const, 403);

  const feedback = await prisma.similarityFeedback.findMany({
    select: { isSimilar: true, searchQueryId: true, trackId: true },
  });

  if (feedback.length < MIN_SAMPLES) {
    return c.json({ error: `Need at least ${MIN_SAMPLES} labeled samples, got ${feedback.length}.` } as const, 422);
  }

  const results = await prisma.searchResult.findMany({
    where: {
      OR: feedback.map((f) => ({ searchQueryId: f.searchQueryId, trackId: f.trackId })),
    },
    select: { searchQueryId: true, trackId: true, features: true },
  });

  const featuresByKey = new Map(results.map((r) => [`${r.searchQueryId}:${r.trackId}`, r.features]));

  const samples = feedback.flatMap((f) => {
    const raw = featuresByKey.get(`${f.searchQueryId}:${f.trackId}`);
    const parsed = TrackFeaturesSchema.safeParse(raw);
    if (!parsed.success) return [];
    return [{ features: parsed.data, is_similar: f.isSimilar }];
  });

  if (samples.length < MIN_SAMPLES) {
    return c.json({ error: `Only ${samples.length} samples have feature data (need ${MIN_SAMPLES}).` } as const, 422);
  }

  const pythonServiceUrl = c.var.pythonServiceUrl;
  const result = await trainWeights({ samples }, { baseURL: pythonServiceUrl });

  const version = await prisma.modelWeights.count();

  await prisma.$transaction([
    prisma.modelWeights.create({
      data: {
        version: version + 1,
        trainedAt: new Date(),
        sampleSize: result.sample_size,
        rankDecayK: result.rank_decay_k,
        cosineScoreWeight: result.cosine_score_weight,
        numSourcesWeight: result.num_sources_weight,
        sourceWeights: {
          create: Object.entries(result.source_weights).map(([source, weight]) => ({
            source: source as Parameters<typeof prisma.sourceWeight.create>[0]["data"]["source"],
            weight,
          })),
        },
      },
    }),
  ]);

  return c.json({
    ok: true,
    version: version + 1,
    sampleSize: result.sample_size,
    sourceWeights: result.source_weights,
  } as const);
});
