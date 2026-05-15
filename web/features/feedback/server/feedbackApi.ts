import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { requireTrainer } from "@/lib/auth-utils";
import type { AppEnv } from "@/lib/hono/types";
import { prisma } from "@/lib/prisma";

const SimilarityFeedbackBodySchema = z.object({
  searchQueryId: z.string(),
  trackId: z.string(),
  isSimilar: z.boolean(),
});

export const feedbackApi = new Hono<AppEnv>().post(
  "/feedback/similarity",
  zValidator("json", SimilarityFeedbackBodySchema),
  async (c) => {
    const user = await requireTrainer().catch(() => null);
    if (!user) return c.json({ error: "Forbidden" } as const, 403);

    const { searchQueryId, trackId, isSimilar } = c.req.valid("json");

    await prisma.similarityFeedback.upsert({
      where: { userId_searchQueryId_trackId: { userId: user.id, searchQueryId, trackId } },
      create: { userId: user.id, searchQueryId, trackId, isSimilar },
      update: { isSimilar },
    });

    return c.json({ ok: true } as const);
  },
);
