import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { requireUser } from "@/lib/auth-utils";
import type { AppEnv } from "@/lib/hono/types";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  source: z.string().min(1).max(64),
  sourceUrl: z.string().min(1).max(512),
  title: z.string().min(1).max(512),
  artist: z.string().min(1).max(512),
  coverUrl: z.string().max(1024).nullable().optional(),
});

export const favoriteAddBySourceRoute = new Hono<AppEnv>().post(
  "/favorites/by-source",
  zValidator("json", schema),
  async (c) => {
    const user = await requireUser();
    const { source, sourceUrl, title, artist, coverUrl } = c.req.valid("json");

    await prisma.track.createMany({
      data: [{ source, sourceUrl, title, artist, coverUrl: coverUrl ?? null }],
      skipDuplicates: true,
    });

    const track = await prisma.track.findUnique({
      where: { sourceUrl },
      select: { id: true },
    });
    if (!track) return c.json({ ok: false } as const, 500);

    await prisma.favorite.createMany({
      data: [{ userId: user.id, trackId: track.id }],
      skipDuplicates: true,
    });

    return c.json({ ok: true, trackId: track.id } as const);
  },
);
