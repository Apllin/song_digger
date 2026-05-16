import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { AppEnv } from "@/lib/hono/types";
import { bandcampReleaseTracklist } from "@/lib/python-api/generated/clients/bandcampReleaseTracklist";
import { getReleaseTracklist } from "@/lib/python-api/generated/clients/getReleaseTracklist";

// Flat schema with optional fields — Zod discriminated unions don't play nicely
// with Hono query coercion. Handler validates the per-source required fields.
const schema = z.object({
  source: z.enum(["discogs", "bandcamp"]).default("discogs"),
  releaseId: z.string().trim().regex(/^\d+$/).max(12).optional(),
  type: z.enum(["release", "master"]).default("release"),
  url: z.string().trim().min(1).max(2048).optional(),
});

export const tracklistRoute = new Hono<AppEnv>().get(
  "/discography/tracklist",
  zValidator("query", schema),
  async (c) => {
    const { source, releaseId, type, url } = c.req.valid("query");
    if (source === "bandcamp") {
      if (!url) throw new HTTPException(400, { message: "url is required for source=bandcamp" });
      const data = await bandcampReleaseTracklist({ url }, { baseURL: c.var.pythonServiceUrl });
      return c.json(data);
    }
    if (!releaseId) throw new HTTPException(400, { message: "releaseId is required for source=discogs" });
    const data = await getReleaseTracklist(
      Number(releaseId),
      { release_type: type },
      { baseURL: c.var.pythonServiceUrl },
    );
    return c.json(data);
  },
);
