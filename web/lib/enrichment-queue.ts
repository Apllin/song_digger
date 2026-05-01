import { prisma } from "@/lib/prisma";
import { enrichTracks, type TrackMeta } from "@/lib/python-client";

/**
 * Fire-and-forget Beatport enrichment for tracks beyond the inline budget.
 * Runs after the search response is sent, persists into Track so subsequent
 * searches hit the Postgres cache instead of Beatport.
 *
 * Lost on Node restart — acceptable for non-critical background fill.
 * See docs/decisions/0007-beatport-cache-strategy.md for the rationale.
 */
export async function enqueueBackgroundEnrich(
  tracks: TrackMeta[],
): Promise<void> {
  if (!tracks.length) return;

  const enriched = await enrichTracks(tracks);

  const updated = enriched.filter((t) => t.bpm != null || t.key != null);
  if (!updated.length) return;

  await Promise.all(
    updated.map((t) =>
      prisma.track
        .update({
          where: { sourceUrl: t.sourceUrl },
          data: {
            bpm: t.bpm ?? undefined,
            key: t.key ?? undefined,
            energy: t.energy ?? undefined,
            genre: t.genre ?? undefined,
            label: t.label ?? undefined,
          },
        })
        .catch((err) => {
          console.error(`[enrichment-queue] update failed for ${t.sourceUrl}:`, err);
        }),
    ),
  );
}
