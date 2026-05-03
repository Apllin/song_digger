import { NextRequest } from "next/server";
import { extractBandcampAudio } from "@/lib/scrapers/bandcamp";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url || !/^https?:\/\/(?:[^/]*\.)?bandcamp\.com\//.test(url)) {
    return Response.json({ error: "invalid url" }, { status: 400 });
  }

  const result = await extractBandcampAudio(url);
  if (!result) {
    return Response.json({ error: "no audio" }, { status: 404 });
  }
  return Response.json(result);
}
