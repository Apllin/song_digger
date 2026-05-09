import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { requireUser } from "@/lib/auth-utils";
import type { AppEnv } from "@/lib/hono/types";
import { prisma } from "@/lib/prisma";

const TrackIdSchema = z.string().min(1).max(64);

const FavoriteBodySchema = z.object({
  trackId: TrackIdSchema,
});

const FavoriteDeleteQuerySchema = z.object({
  trackId: TrackIdSchema,
});

export const favoriteApi = new Hono<AppEnv>()
  .get("/favorites", async (c) => {
    const user = await requireUser().catch(() => null);
    if (!user) return c.json({ error: "Unauthorized" } as const, 401);

    const favorites = await prisma.favorite.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: { track: true },
    });
    return c.json(favorites.map((fav) => fav.track));
  })
  .post("/favorites", zValidator("json", FavoriteBodySchema), async (c) => {
    const user = await requireUser().catch(() => null);
    if (!user) return c.json({ error: "Unauthorized" } as const, 401);

    const { trackId } = c.req.valid("json");
    try {
      await prisma.favorite.create({
        data: { userId: user.id, trackId },
      });
      return c.json({ ok: true } as const);
    } catch {
      return c.json({ error: "Already favorited" } as const, 409);
    }
  })
  .delete("/favorites", zValidator("query", FavoriteDeleteQuerySchema), async (c) => {
    const user = await requireUser().catch(() => null);
    if (!user) return c.json({ error: "Unauthorized" } as const, 401);

    const { trackId } = c.req.valid("query");
    await prisma.favorite.deleteMany({
      where: { userId: user.id, trackId },
    });
    return c.json({ ok: true } as const);
  });
