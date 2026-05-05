import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-utils";

export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const favorites = await prisma.favorite.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: { track: true },
  });

  return Response.json(favorites.map((fav) => fav.track));
}

const FavoriteSchema = z.object({ trackId: z.string().min(1).max(64) });

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = FavoriteSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    await prisma.favorite.create({
      data: { userId: user.id, trackId: parsed.data.trackId },
    });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Already favorited" }, { status: 409 });
  }
}

export async function DELETE(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const parsed = FavoriteSchema.shape.trackId.safeParse(
    searchParams.get("trackId"),
  );
  if (!parsed.success) {
    return Response.json({ error: "trackId required" }, { status: 400 });
  }

  await prisma.favorite.deleteMany({
    where: { userId: user.id, trackId: parsed.data },
  });
  return Response.json({ ok: true });
}
