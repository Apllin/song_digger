import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { requireUser } from "@/lib/auth-utils";
import type { AppEnv } from "@/lib/hono/types";
import { prisma } from "@/lib/prisma";

const DislikeBodySchema = z.object({
  artist: z.string().trim().min(1).max(500),
  title: z.string().trim().min(1).max(500),
  artistKey: z.string().max(500).default(""),
  titleKey: z.string().max(500).default(""),
});

export const dislikeApi = new Hono<AppEnv>()
  .get("/dislikes", async (c) => {
    const user = await requireUser().catch(() => null);
    if (!user) return c.json({ error: "Unauthorized" } as const, 401);

    const rows = await prisma.dislikedTrack.findMany({
      where: { userId: user.id },
      select: { artistKey: true, titleKey: true, artist: true, title: true },
    });
    return c.json(rows);
  })
  .post("/dislikes", zValidator("json", DislikeBodySchema), async (c) => {
    const user = await requireUser().catch(() => null);
    if (!user) return c.json({ error: "Unauthorized" } as const, 401);

    const { artist, title, artistKey, titleKey } = c.req.valid("json");

    await prisma.dislikedTrack.upsert({
      where: { userId_artistKey_titleKey: { userId: user.id, artistKey, titleKey } },
      create: { userId: user.id, artistKey, titleKey, artist, title },
      update: {},
    });
    return c.json({ ok: true } as const);
  })
  .delete("/dislikes", zValidator("json", DislikeBodySchema), async (c) => {
    const user = await requireUser().catch(() => null);
    if (!user) return c.json({ error: "Unauthorized" } as const, 401);

    const { artistKey, titleKey } = c.req.valid("json");

    await prisma.dislikedTrack.deleteMany({
      where: { userId: user.id, artistKey, titleKey },
    });
    return c.json({ ok: true } as const);
  });
