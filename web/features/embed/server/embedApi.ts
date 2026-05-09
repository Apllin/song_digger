import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { lookupEmbedCache, upsertEmbedCache } from "@/lib/embed-cache";
import { resolveEmbed } from "@/lib/embed-resolver";
import type { AppEnv } from "@/lib/hono/types";

const EmbedQuerySchema = z.object({
  title: z.string().trim().min(1).max(500),
  artist: z.string().trim().min(1).max(500),
});

export const embedApi = new Hono<AppEnv>().get("/embed", zValidator("query", EmbedQuerySchema), async (c) => {
  const { title, artist } = c.req.valid("query");

  const cached = await lookupEmbedCache(artist, title).catch(() => null);
  if (cached) return c.json(cached);

  const resolved = await resolveEmbed(title, artist);

  // Upsert is best-effort; never blocks the response.
  upsertEmbedCache(artist, title, {
    embedUrl: resolved.embedUrl,
    source: resolved.source,
    sourceUrl: resolved.sourceUrl ?? null,
    coverUrl: resolved.coverUrl ?? null,
  }).catch((err) => console.error("[embed-cache] upsert failed:", err));

  // Normalize to the cache-entry shape so cached and freshly-resolved
  // responses are indistinguishable to callers.
  return c.json({
    embedUrl: resolved.embedUrl,
    source: resolved.source,
    sourceUrl: resolved.sourceUrl ?? null,
    coverUrl: resolved.coverUrl ?? null,
  });
});
