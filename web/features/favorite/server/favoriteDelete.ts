import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { requireUser } from "@/lib/auth-utils";
import type { AppEnv } from "@/lib/hono/types";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  trackId: z.string().min(1).max(64),
});

export const favoriteDeleteRoute = new Hono<AppEnv>().delete("/favorites", zValidator("query", schema), async (c) => {
  const user = await requireUser();

  const { trackId } = c.req.valid("query");
  await prisma.favorite.deleteMany({
    where: { userId: user.id, trackId },
  });
  return c.json({ ok: true } as const);
});
