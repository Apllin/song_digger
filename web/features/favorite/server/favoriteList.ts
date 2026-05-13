import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import { favoritesPageQuerySchema } from "@/features/favorite/schemas";
import { requireUser } from "@/lib/auth-utils";
import type { AppEnv } from "@/lib/hono/types";
import { prisma } from "@/lib/prisma";

export const favoriteListRoute = new Hono<AppEnv>().get(
  "/favorites",
  zValidator("query", favoritesPageQuerySchema),
  async (c) => {
    const user = await requireUser();

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
  },
);
