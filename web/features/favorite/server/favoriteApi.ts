import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { Prisma } from "@/app/generated/prisma/client";
import { favoritesPageQuerySchema } from "@/features/favorite/schemas";
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
  // Full id list, newest first — drives the home-page result filter and the
  // heart state on track cards. Kept separate from the paginated list below so
  // those consumers don't depend on a particular page.
  .get("/favorites/ids", async (c) => {
    const user = await requireUser().catch(() => null);
    if (!user) return c.json({ error: "Unauthorized" } as const, 401);

    const rows = await prisma.favorite.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { trackId: true },
    });
    return c.json(rows.map((r) => r.trackId));
  })
  .get("/favorites", zValidator("query", favoritesPageQuerySchema), async (c) => {
    const user = await requireUser().catch(() => null);
    if (!user) return c.json({ error: "Unauthorized" } as const, 401);

    const { page, perPage } = c.req.valid("query");
    const [items, rows] = await Promise.all([
      prisma.favorite.count({ where: { userId: user.id } }),
      prisma.favorite.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
        include: { track: true },
      }),
    ]);

    return c.json({
      tracks: rows.map((r) => r.track),
      pagination: {
        page,
        pages: Math.max(1, Math.ceil(items / perPage)),
        per_page: perPage,
        items,
      },
    });
  })
  .post("/favorites", zValidator("json", FavoriteBodySchema), async (c) => {
    const user = await requireUser().catch(() => null);
    if (!user) return c.json({ error: "Unauthorized" } as const, 401);

    const { trackId } = c.req.valid("json");
    try {
      // Idempotent: a client whose `/favorites/ids` query hasn't resolved yet
      // can render an already-saved track as un-favorited and re-POST it.
      // That's the desired end state, not a conflict — `skipDuplicates` no-ops
      // on the (userId, trackId) unique instead of erroring.
      await prisma.favorite.createMany({
        data: [{ userId: user.id, trackId }],
        skipDuplicates: true,
      });
    } catch (err) {
      // P2003 = foreign-key violation: the JWT points at a user that no longer
      // exists (e.g. the dev DB was re-initialised under a live session), or
      // the payload at a track that isn't in the catalog. Either way the
      // client should re-auth rather than see a 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
        return c.json({ error: "Session is no longer valid — please sign in again." } as const, 401);
      }
      throw err;
    }
    return c.json({ ok: true } as const);
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
