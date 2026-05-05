import { NextRequest } from "next/server";
import { z } from "zod";
import { resolveEmbed } from "@/lib/embed-resolver";

const ParamSchema = z.string().trim().min(1).max(500);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const title = ParamSchema.safeParse(searchParams.get("title") ?? "");
  const artist = ParamSchema.safeParse(searchParams.get("artist") ?? "");

  if (!title.success || !artist.success) {
    return Response.json({ embedUrl: null, source: null }, { status: 400 });
  }

  const result = await resolveEmbed(title.data, artist.data);
  return Response.json(result);
}
