import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import type { AppEnv } from "@/lib/hono/types";
import { getReleaseTracklist } from "@/lib/python-api/generated/clients/getReleaseTracklist";
import { pythonServiceHeaders } from "@/lib/python-api/headers";

const schema = z.object({
  releaseId: z.string().trim().regex(/^\d+$/).max(12),
  type: z.enum(["release", "master"]).default("release"),
});

export const tracklistRoute = new Hono<AppEnv>().get(
  "/discography/tracklist",
  zValidator("query", schema),
  async (c) => {
    const { releaseId, type } = c.req.valid("query");
    const data = await getReleaseTracklist(
      Number(releaseId),
      { release_type: type },
      { baseURL: c.var.pythonServiceUrl, headers: pythonServiceHeaders() },
    );
    return c.json(data);
  },
);
