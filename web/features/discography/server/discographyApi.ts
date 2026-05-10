import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { anonGate } from "@/lib/hono/anonGate";
import type { AppEnv } from "@/lib/hono/types";
import { getArtistReleases } from "@/lib/python-api/generated/clients/getArtistReleases";
import { getReleaseTracklist } from "@/lib/python-api/generated/clients/getReleaseTracklist";
import { searchArtists } from "@/lib/python-api/generated/clients/searchArtists";
import { searchLabels } from "@/lib/python-api/generated/clients/searchLabels";

const ArtistSearchSchema = z.object({
  q: z.string().trim().min(1).max(200),
});

const LabelSearchSchema = z.object({
  q: z.string().trim().min(1).max(200),
});

// Discogs numeric IDs are bounded; cap to int <= 10^9 to avoid pathological
// strings landing in the upstream URL. Python returns the full filtered list
// for an artist+role pair; the consumer paginates client-side.
const ReleasesSchema = z.object({
  artistId: z.coerce.number().int().positive().max(1_000_000_000),
  role: z.enum(["Main"]).optional(),
});

const TracklistSchema = z.object({
  releaseId: z.coerce.number().int().positive().max(1_000_000_000),
  type: z.enum(["release", "master"]).default("release"),
});

export const discographyApi = new Hono<AppEnv>()
  .get("/discography/search", anonGate, zValidator("query", ArtistSearchSchema), async (c) => {
    const { q } = c.req.valid("query");
    try {
      const data = await searchArtists({ q }, { baseURL: c.var.pythonServiceUrl });
      return c.json(data);
    } catch {
      return c.json({ error: "upstream error" } as const, 502);
    }
  })
  .get("/discography/releases", zValidator("query", ReleasesSchema), async (c) => {
    const { artistId, role } = c.req.valid("query");
    try {
      const data = await getArtistReleases(artistId, { role }, { baseURL: c.var.pythonServiceUrl });
      return c.json(data);
    } catch {
      return c.json({ error: "upstream error" } as const, 502);
    }
  })
  .get("/discography/tracklist", zValidator("query", TracklistSchema), async (c) => {
    const { releaseId, type } = c.req.valid("query");
    try {
      const data = await getReleaseTracklist(releaseId, { release_type: type }, { baseURL: c.var.pythonServiceUrl });
      return c.json(data);
    } catch {
      return c.json({ error: "upstream error" } as const, 502);
    }
  })
  .get("/discography/label/search", anonGate, zValidator("query", LabelSearchSchema), async (c) => {
    const { q } = c.req.valid("query");
    try {
      const data = await searchLabels({ q }, { baseURL: c.var.pythonServiceUrl });
      return c.json(data);
    } catch {
      return c.json({ error: "upstream error" } as const, 502);
    }
  });
