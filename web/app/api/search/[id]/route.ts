import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    sourceBpm: searchQuery.sourceBpm,
    sourceKey: searchQuery.sourceKey,
    tracks: searchQuery.results.map((r) => ({ ...r.track, score: r.score })),
  });
}
