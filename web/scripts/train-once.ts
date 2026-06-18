import process from "node:process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, SimilaritySource } from "../app/generated/prisma/client.ts";
import { type TrackFeatures, TrackFeaturesSchema } from "../lib/aggregator.ts";
import { trainWeights } from "../lib/python-api/generated/clients/trainWeights.ts";
// Side-effect import: configures the python-service client (baseURL + auth) at startup.
import "../lib/python-api/client.ts";

const MIN_SAMPLES = 20;

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

interface TrainSample {
  features: TrackFeatures;
  is_similar: boolean;
}

async function main() {
  const feedback = await prisma.similarityFeedback.findMany({
    select: { isSimilar: true, searchQueryId: true, trackId: true },
  });

  console.log(`feedback rows: ${feedback.length}`);
  if (feedback.length < MIN_SAMPLES) {
    throw new Error(`Need at least ${MIN_SAMPLES} labeled samples, got ${feedback.length}.`);
  }

  const results = await prisma.searchResult.findMany({
    where: { OR: feedback.map((f) => ({ searchQueryId: f.searchQueryId, trackId: f.trackId })) },
    select: { searchQueryId: true, trackId: true, features: true },
  });

  const featuresByKey = new Map(results.map((r) => [`${r.searchQueryId}:${r.trackId}`, r.features]));

  const samples = feedback.flatMap<TrainSample>((f) => {
    const parsed = TrackFeaturesSchema.safeParse(featuresByKey.get(`${f.searchQueryId}:${f.trackId}`));
    if (!parsed.success) return [];
    return [{ features: parsed.data, is_similar: f.isSimilar }];
  });

  console.log(`samples with valid features: ${samples.length}`);
  if (samples.length < MIN_SAMPLES) {
    throw new Error(`Only ${samples.length} samples have feature data (need ${MIN_SAMPLES}).`);
  }

  const result = await trainWeights({ samples });
  console.log("python /train ok:", result);

  const latest = await prisma.modelWeights.findFirst({
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const nextVersion = (latest?.version ?? 0) + 1;

  const created = await prisma.modelWeights.create({
    data: {
      version: nextVersion,
      trainedAt: new Date(),
      sampleSize: result.sample_size,
      rankDecayK: result.rank_decay_k,
      cosineScoreWeight: result.cosine_score_weight,
      numSourcesWeight: result.num_sources_weight,
      sourceWeights: {
        create: Object.entries(result.source_weights).map(([source, weight]) => ({
          source: source as SimilaritySource,
          weight,
        })),
      },
    },
    include: { sourceWeights: true },
  });

  console.log(`ModelWeights v${created.version} saved (id=${created.id}, samples=${created.sampleSize})`);
  console.log("source weights:", Object.fromEntries(created.sourceWeights.map((w) => [w.source, w.weight])));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
