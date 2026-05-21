import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { ArtistIdSchema } from "@/features/discography/schemas";
import { HttpError } from "@/lib/hono/httpError";
import type { AppEnv } from "@/lib/hono/types";
import { prisma } from "@/lib/prisma";

export const artistByIdRoute = new Hono<AppEnv>().get(
  "/discography/artists/:id",
  zValidator("param", z.object({ id: ArtistIdSchema })),
  async (c) => {
    const { id } = c.req.valid("param");
    const artist = await prisma.artist.findUnique({ where: { id } });
    if (!artist) throw new HttpError(404, { message: "Artist not found." });
    return c.json({
      id: Number(artist.id),
      name: artist.name,
      imageUrl: artist.imageUrl ?? null,
      resourceUrl: artist.resourceUrl ?? null,
    });
  },
);
