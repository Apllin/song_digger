import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../app/generated/prisma/client.ts";

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";
const MIN_SAMPLES = 20;

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function isValidFeatures(raw) {
  if (!raw || typeof raw !== "object") return false;
  if (!Array.isArray(raw.appearances)) return false;
  if (!raw.appearances.every((a) => typeof a?.source === "string" && typeof a?.rank === "number")) return false;
  if (typeof raw.numSources !== "number") return false;
  if (typeof raw.minSourceRank !== "number") return false;
  if (raw.cosineScore !== null && typeof raw.cosineScore !== "number") return false;
  if (typeof raw.rrfScore !== "number") return false;
  return true;
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

  const samples = feedback.flatMap((f) => {
    const raw = featuresByKey.get(`${f.searchQueryId}:${f.trackId}`);
    if (!isValidFeatures(raw)) return [];
    return [{ features: raw, is_similar: f.isSimilar }];
  });

  console.log(`samples with valid features: ${samples.length}`);
  if (samples.length < MIN_SAMPLES) {
    throw new Error(`Only ${samples.length} samples have feature data (need ${MIN_SAMPLES}).`);
  }

  const res = await fetch(`${PYTHON_SERVICE_URL}/train`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ samples }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`python /train failed ${res.status}: ${body}`);
  }

  const result = await res.json();
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
        create: Object.entries(result.source_weights).map(([source, weight]) => ({ source, weight })),
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
