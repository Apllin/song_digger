import { NextRequest } from "next/server";
import { z } from "zod";
import { resolveEmbed } from "@/lib/embed-resolver";
import { lookupEmbedCache, upsertEmbedCache } from "@/lib/embed-cache";

const ParamSchema = z.string().trim().min(1).max(500);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const title = ParamSchema.safeParse(searchParams.get("title") ?? "");
  const artist = ParamSchema.safeParse(searchParams.get("artist") ?? "");

  if (!title.success || !artist.success) {
    return Response.json({ embedUrl: null, source: null }, { status: 400 });
  }

  const cached = await lookupEmbedCache(artist.data, title.data).catch(() => null);
  if (cached) return Response.json(cached);

  const resolved = await resolveEmbed(title.data, artist.data);

  upsertEmbedCache(artist.data, title.data, {
    embedUrl: resolved.embedUrl,
    source: resolved.source,
    sourceUrl: resolved.sourceUrl ?? null,
    coverUrl: resolved.coverUrl ?? null,
  }).catch((err) => console.error("[embed-cache] upsert failed:", err));

  return Response.json(resolved);
}
