import { prisma } from "@/lib/prisma";

export type FeedbackTotals = { total: number; yes: number; no: number };

export type SourceHitRate = {
  source: string;
  total: number;
  similar: number;
  rate: number;
};

export type DailyFeedback = { day: string; count: number };

export type ModelHistoryEntry = {
  version: number;
  trainedAt: Date;
  sampleSize: number;
};

export async function loadFeedbackTotals(): Promise<FeedbackTotals> {
  const [total, yes] = await Promise.all([
    prisma.similarityFeedback.count(),
    prisma.similarityFeedback.count({ where: { isSimilar: true } }),
  ]);
  return { total, yes, no: total - yes };
}

/**
 * For each source that ever contributed a track marked by a trainer, count
 * how many of those judgments were positive. `rate = similar / total` answers
 * "when this source surfaces a track and a trainer rates it, how often does
 * the trainer agree it's similar". A low rate means that source is bringing
 * off-topic candidates.
 */
export async function loadSourceHitRates(): Promise<SourceHitRate[]> {
  const rows = await prisma.$queryRaw<{ source: string; similar: bigint; total: bigint }[]>`
    SELECT
      unnest(sr.sources) AS source,
      COUNT(*) FILTER (WHERE sf."isSimilar") AS similar,
      COUNT(*) AS total
    FROM "SimilarityFeedback" sf
    JOIN "SearchResult" sr
      ON sr."searchQueryId" = sf."searchQueryId"
     AND sr."trackId" = sf."trackId"
    GROUP BY 1
    ORDER BY 3 DESC
  `;
  return rows.map((r) => {
    const total = Number(r.total);
    const similar = Number(r.similar);
    return {
      source: r.source,
      total,
      similar,
      rate: total === 0 ? 0 : similar / total,
    };
  });
}

export async function loadFeedbackPerDay(days = 14): Promise<DailyFeedback[]> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (days - 1));
  const rows = await prisma.$queryRaw<{ day: Date; count: bigint }[]>`
    SELECT
      DATE_TRUNC('day', "createdAt")::date AS day,
      COUNT(*)::bigint AS count
    FROM "SimilarityFeedback"
    WHERE "createdAt" >= ${since}
    GROUP BY 1
    ORDER BY 1
  `;
  const byDay = new Map<string, number>(rows.map((r) => [r.day.toISOString().slice(0, 10), Number(r.count)]));
  const out: DailyFeedback[] = [];
  const cursor = new Date(since);
  for (let i = 0; i < days; i++) {
    const key = cursor.toISOString().slice(0, 10);
    out.push({ day: key, count: byDay.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export async function loadModelHistory(limit = 5): Promise<ModelHistoryEntry[]> {
  const rows = await prisma.modelWeights.findMany({
    orderBy: { version: "desc" },
    take: limit,
    select: { version: true, trainedAt: true, sampleSize: true },
  });
  return rows;
}
