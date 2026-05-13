import { Hono } from "hono";

import { requireUser } from "@/lib/auth-utils";
import type { AppEnv } from "@/lib/hono/types";
import { prisma } from "@/lib/prisma";

export const favoriteIdsRoute = new Hono<AppEnv>().get("/favorites/ids", async (c) => {
  const user = await requireUser();

  const rows = await prisma.favorite.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { trackId: true },
  });
  return c.json(rows.map((r) => r.trackId));
});
