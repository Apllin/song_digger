import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { anonGate } from "@/lib/hono/anonGate";
import type { AppEnv } from "@/lib/hono/types";
import { prisma } from "@/lib/prisma";
import { searchArtists } from "@/lib/python-api/generated/clients/searchArtists";

const schema = z.object({
  q: z.string().trim().min(1).max(200),
});

export const artistSearchRoute = new Hono<AppEnv>().get(
  "/discography/search",
  anonGate,
  zValidator("query", schema),
  async (c) => {
    const { q } = c.req.valid("query");
    const data = await searchArtists({ q });

    void prisma.$transaction(
      data.map((a) =>
        prisma.artist.upsert({
          where: { id: String(a.id) },
          create: { id: String(a.id), name: a.name, imageUrl: a.imageUrl ?? null, resourceUrl: a.resourceUrl ?? null },
          update: { name: a.name, imageUrl: a.imageUrl ?? null, resourceUrl: a.resourceUrl ?? null },
        }),
      ),
    );

    return c.json(data);
  },
);
