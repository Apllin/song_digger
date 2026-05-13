import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { requireUser } from "@/lib/auth-utils";
import type { AppEnv } from "@/lib/hono/types";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  trackId: z.string().min(1).max(64),
});

export const favoriteAddRoute = new Hono<AppEnv>().post("/favorites", zValidator("json", schema), async (c) => {
  const user = await requireUser();
  const { trackId } = c.req.valid("json");

  await prisma.favorite.createMany({
    data: [{ userId: user.id, trackId }],
    skipDuplicates: true,
  });

  return c.json({ ok: true } as const);
});
