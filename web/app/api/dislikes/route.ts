import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeArtist, normalizeTitle } from "@/lib/aggregator";

export async function GET() {
  const rows = await prisma.dislikedTrack.findMany({
    select: { artistKey: true, titleKey: true, artist: true, title: true },
  });
  return Response.json(rows);
}

export async function POST(req: NextRequest) {
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
    where: { artistKey_titleKey: { artistKey, titleKey } },
    create: { artistKey, titleKey, artist, title },
    update: {},
  });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
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
    where: { artistKey, titleKey },
  });
  return Response.json({ ok: true });
}
