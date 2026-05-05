import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { normalizeArtist, normalizeTitle } from "@/lib/aggregator";
import { requireUser } from "@/lib/auth-utils";

// Length caps protect against pathological strings (a 10MB title
// would still upsert successfully and bloat the index). 500 covers
// real-world long titles like remixes-of-extended-club-versions.
const DislikeSchema = z.object({
  artist: z.string().trim().min(1).max(500),
  title: z.string().trim().min(1).max(500),
});

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

  const body = await req.json().catch(() => null);
  const parsed = DislikeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const { artist, title } = parsed.data;
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

  const body = await req.json().catch(() => null);
  const parsed = DislikeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const { artist, title } = parsed.data;
  const artistKey = normalizeArtist(artist);
  const titleKey = normalizeTitle(title);

  await prisma.dislikedTrack.deleteMany({
    where: { userId: user.id, artistKey, titleKey },
  });
  return Response.json({ ok: true });
}
