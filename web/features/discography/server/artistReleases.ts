import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import { releasesQuerySchema } from "@/features/discography/schemas";
import type { AppEnv } from "@/lib/hono/types";
import { prisma } from "@/lib/prisma";
import { getArtistReleases } from "@/lib/python-api/generated/clients/getArtistReleases";

const TTL_30D_MS = 30 * 86_400 * 1_000;

export const artistReleasesRoute = new Hono<AppEnv>().get(
  "/discography/releases",
  zValidator("query", releasesQuerySchema),
  async (c) => {
    const { artistId, role, page, perPage, sort } = c.req.valid("query");

    const meta = await prisma.artistReleasesMeta.findUnique({ where: { artistId } });

    if (!meta || Date.now() - meta.fetchedAt.getTime() >= TTL_30D_MS) {
      const { releases } = await getArtistReleases(Number(artistId), {}, { baseURL: c.var.pythonServiceUrl });
      await prisma.$transaction([
        prisma.artistRelease.deleteMany({ where: { artistId } }),
        prisma.artistRelease.createMany({
          data: releases.map((r) => ({
            artistId,
            releaseId: String(r.id),
            title: r.title,
            year: r.year ?? null,
            type: r.type ?? null,
            role: r.role ?? null,
            format: r.format ?? null,
            label: r.label ?? null,
            thumb: r.thumb ?? null,
            resourceUrl: r.resourceUrl ?? null,
          })),
        }),
        prisma.artistReleasesMeta.upsert({
          where: { artistId },
          create: { artistId },
          update: {},
        }),
      ]);
    }

    const where = {
      artistId,
      ...(role === "all" ? {} : { role }),
    };
    const orderBy = {
      year: {
        sort: sort === "year_asc" ? ("asc" as const) : ("desc" as const),
        nulls: "last" as const,
      },
    };

    const [total, rows] = await Promise.all([
      prisma.artistRelease.count({ where }),
      prisma.artistRelease.findMany({
        where,
        orderBy,
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);

    return c.json({
      releases: rows.map((r) => ({
        id: r.releaseId,
        title: r.title,
        year: r.year,
        type: r.type,
        role: r.role,
        format: r.format,
        label: r.label,
        thumb: r.thumb,
        resourceUrl: r.resourceUrl,
      })),
      pagination: {
        page,
        pages: Math.max(1, Math.ceil(total / perPage)),
        per_page: perPage,
        items: total,
      },
    });
  },
);
