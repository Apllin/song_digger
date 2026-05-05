import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeArtist, normalizeTitle } from "@/lib/aggregator";
import { requireUser } from "@/lib/auth-utils";

export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.dislikedTrack.findMany({
    where: { userId: user.id },
    select: { artistKey: true, titleKey: true, artist: true, title: true },
  });
  return Response.json(rows);
}

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { artist, title } = await req.json().catch(() => ({}));
  if (!artist || !title) {
    return Response.json(
      { error: "artist and title required" },
      { status: 400 },
    );
  }
  const artistKey = normalizeArtist(artist);
  const titleKey = normalizeTitle(title);

  await prisma.dislikedTrack.upsert({
    where: {
      userId_artistKey_titleKey: {
        userId: user.id,
        artistKey,
        titleKey,
      },
    },
    create: { userId: user.id, artistKey, titleKey, artist, title },
    update: {},
  });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { artist, title } = await req.json().catch(() => ({}));
  if (!artist || !title) {
    return Response.json(
      { error: "artist and title required" },
      { status: 400 },
    );
  }
  const artistKey = normalizeArtist(artist);
  const titleKey = normalizeTitle(title);

  await prisma.dislikedTrack.deleteMany({
    where: { userId: user.id, artistKey, titleKey },
  });
  return Response.json({ ok: true });
}
