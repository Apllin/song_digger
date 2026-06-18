import { Hono } from "hono";

import { SimilaritySource } from "@/app/generated/prisma/client";
import { TrackFeaturesSchema } from "@/lib/aggregator";
import { requireTrainer } from "@/lib/auth-utils";
import { isCamelotCompatible } from "@/lib/camelot";
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

  const searchIds = [...new Set(feedback.map((f) => f.searchQueryId))];
  const trackIds = [...new Set(feedback.map((f) => f.trackId))];

  const [results, searchQueries, tracks] = await Promise.all([
    prisma.searchResult.findMany({
      where: {
        OR: feedback.map((f) => ({ searchQueryId: f.searchQueryId, trackId: f.trackId })),
      },
      select: { searchQueryId: true, trackId: true, features: true },
    }),
    prisma.searchQuery.findMany({
      where: { id: { in: searchIds } },
      select: { id: true, seedBpm: true, seedMusicalKey: true, seedGenre: true },
    }),
    prisma.track.findMany({
      where: { id: { in: trackIds } },
      select: { id: true, bpm: true, musicalKey: true },
    }),
  ]);

  const featuresByKey = new Map(results.map((r) => [`${r.searchQueryId}:${r.trackId}`, r.features]));
  const sqById = new Map(searchQueries.map((s) => [s.id, s]));
  const trackById = new Map(tracks.map((t) => [t.id, t]));

  const samples = feedback.flatMap((f) => {
    const raw = featuresByKey.get(`${f.searchQueryId}:${f.trackId}`);
    const parsed = TrackFeaturesSchema.safeParse(raw);
    if (!parsed.success) return [];

    const sq = sqById.get(f.searchQueryId);
    const tr = trackById.get(f.trackId);
    const bpmDelta = sq?.seedBpm != null && tr?.bpm != null ? Math.abs(sq.seedBpm - tr.bpm) : null;
    const keyCompatible =
      sq?.seedMusicalKey != null && tr?.musicalKey != null
        ? isCamelotCompatible(sq.seedMusicalKey, tr.musicalKey)
        : null;

    return [
      {
        features: {
          ...parsed.data,
          bpmDelta,
          keyCompatible,
          seedGenre: sq?.seedGenre ?? null,
          seedBpm: sq?.seedBpm ?? null,
        },
        is_similar: f.isSimilar,
      },
    ];
  });

  if (samples.length < MIN_SAMPLES) {
    return c.json({ error: `Only ${samples.length} samples have feature data (need ${MIN_SAMPLES}).` } as const, 422);
  }

  const result = await trainWeights({ samples });

  const latest = await prisma.modelWeights.findFirst({
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const nextVersion = (latest?.version ?? 0) + 1;

  await prisma.modelWeights.create({
    data: {
      version: nextVersion,
      trainedAt: new Date(),
      sampleSize: result.sample_size,
      rankDecayK: result.rank_decay_k,
      cosineScoreWeight: result.cosine_score_weight,
      numSourcesWeight: result.num_sources_weight,
      bpmDeltaWeight: result.bpm_delta_weight,
      bpmCompatibleWeight: result.bpm_compatible_weight,
      bpmPresentWeight: result.bpm_present_weight,
      keyCompatibleWeight: result.key_compatible_weight,
      keyPresentWeight: result.key_present_weight,
      genreAdjustments: result.genre_adjustments ?? {},
      bpmRangeAdjustments: result.bpm_range_adjustments ?? {},
      sourceWeights: {
        create: Object.entries(result.source_weights).map(([source, weight]) => ({
          source: source as SimilaritySource,
          weight,
        })),
      },
    },
  });

  return c.json({
    ok: true,
    version: nextVersion,
    sampleSize: result.sample_size,
    sourceWeights: result.source_weights,
    cosineScoreWeight: result.cosine_score_weight,
    numSourcesWeight: result.num_sources_weight,
    bpmDeltaWeight: result.bpm_delta_weight,
    bpmCompatibleWeight: result.bpm_compatible_weight,
    bpmPresentWeight: result.bpm_present_weight,
    keyCompatibleWeight: result.key_compatible_weight,
    keyPresentWeight: result.key_present_weight,
  } as const);
});
