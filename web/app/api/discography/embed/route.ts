import { NextRequest } from "next/server";
import { resolveEmbed } from "@/lib/embed-resolver";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const title = searchParams.get("title") ?? "";
  const artist = searchParams.get("artist") ?? "";

  if (!title || !artist) {
    return Response.json({ embedUrl: null, source: null }, { status: 400 });
  }

  const result = await resolveEmbed(title, artist);
  return Response.json(result);
}
