import { Hono } from "hono";

import { requireUser } from "@/lib/auth-utils";
import type { AppEnv } from "@/lib/hono/types";
import { prisma } from "@/lib/prisma";

export const favoriteSourceUrlsRoute = new Hono<AppEnv>().get("/favorites/source-urls", async (c) => {
  const user = await requireUser();

  const rows = await prisma.favorite.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { track: { select: { sourceUrl: true } } },
  });
  return c.json(rows.map((r) => r.track.sourceUrl));
});
