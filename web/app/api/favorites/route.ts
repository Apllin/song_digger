import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const favorites = await prisma.favorite.findMany({
    orderBy: { createdAt: "desc" },
    include: { track: true },
  });

  return Response.json(favorites.map((fav) => fav.track));
}

const FavoriteSchema = z.object({ trackId: z.string().min(1) });

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = FavoriteSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    await prisma.favorite.create({ data: { trackId: parsed.data.trackId } });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Already favorited" }, { status: 409 });
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const trackId = searchParams.get("trackId");

  if (!trackId) {
    return Response.json({ error: "trackId required" }, { status: 400 });
  }

  await prisma.favorite.deleteMany({ where: { trackId } });
  return Response.json({ ok: true });
}
