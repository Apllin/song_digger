import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const rows = await prisma.dislikedTrack.findMany({ select: { sourceUrl: true } });
  return Response.json(rows.map((r) => r.sourceUrl));
}

export async function POST(req: NextRequest) {
  const { sourceUrl, title, artist } = await req.json().catch(() => ({}));
  if (!sourceUrl) return Response.json({ error: "sourceUrl required" }, { status: 400 });

  await prisma.dislikedTrack.upsert({
    where: { sourceUrl },
    create: { sourceUrl, title: title ?? "", artist: artist ?? "" },
    update: {},
  });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sourceUrl = searchParams.get("sourceUrl");
  if (!sourceUrl) return Response.json({ error: "sourceUrl required" }, { status: 400 });

  await prisma.dislikedTrack.deleteMany({ where: { sourceUrl } });
  return Response.json({ ok: true });
}
