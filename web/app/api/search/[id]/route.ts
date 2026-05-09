import { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const searchQuery = await prisma.searchQuery.findUnique({
    where: { id },
    include: {
      results: {
        orderBy: { score: "desc" },
        include: { track: true },
      },
    },
  });

  if (!searchQuery) {
    return Response.json({ error: "Search not found" }, { status: 404 });
  }

  return Response.json({
    id: searchQuery.id,
    status: searchQuery.status,
    tracks: searchQuery.results.map((r) => ({
      ...r.track,
      score: r.score,
      // Multiple adapter sources can surface the same identity; the chip-row
      // in the UI renders one chip per entry. Old SearchResult rows from
      // before this column existed default to [] — UI falls back to [source].
      sources: r.sources.length ? r.sources : [r.track.source],
    })),
  });
}
