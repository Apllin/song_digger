import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { lookupCover } from "@/lib/cover-enrichment";
import type { AppEnv } from "@/lib/hono/types";

const schema = z.object({
  artist: z.string().trim().min(1).max(300),
  title: z.string().trim().min(1).max(300),
});

// On-demand cover lookup for the client. Tracks an adapter left without
// artwork enrich here (cache-first iTunes) instead of on the search hot path.
export const coverApi = new Hono<AppEnv>().get("/cover", zValidator("query", schema), async (c) => {
  const { artist, title } = c.req.valid("query");
  const coverUrl = await lookupCover(artist, title);
  return c.json({ coverUrl });
});
