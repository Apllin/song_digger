import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import type { AppEnv } from "@/lib/hono/types";
import { extractBandcampAudio } from "@/lib/scrapers/bandcamp";

const BandcampAudioQuerySchema = z.object({
  url: z.string().regex(/^https?:\/\/(?:[^/]*\.)?bandcamp\.com\//, "must be a bandcamp URL"),
});

export const bandcampAudioApi = new Hono<AppEnv>().get(
  "/bandcamp-audio",
  zValidator("query", BandcampAudioQuerySchema),
  async (c) => {
    const { url } = c.req.valid("query");
    const result = await extractBandcampAudio(url);
    if (!result) {
      return c.json({ error: "no audio" } as const, 404);
    }
    return c.json(result);
  },
);
