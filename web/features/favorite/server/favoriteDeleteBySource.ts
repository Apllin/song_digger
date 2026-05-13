import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { requireUser } from "@/lib/auth-utils";
import type { AppEnv } from "@/lib/hono/types";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  sourceUrl: z.string().min(1).max(512),
});

export const favoriteDeleteBySourceRoute = new Hono<AppEnv>().delete(
  "/favorites/by-source",
  zValidator("query", schema),
  async (c) => {
    const user = await requireUser();
    const { sourceUrl } = c.req.valid("query");

    const track = await prisma.track.findUnique({
      where: { sourceUrl },
      select: { id: true },
    });
    if (track) {
      await prisma.favorite.deleteMany({
        where: { userId: user.id, trackId: track.id },
      });
    }

    return c.json({ ok: true } as const);
  },
);
