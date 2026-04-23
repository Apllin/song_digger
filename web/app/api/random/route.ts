import { fetchRandomTrack } from "@/lib/python-client";
import { getRandomTechnoTrack } from "@/lib/scrapers/bandcamp";

export async function GET() {
  // Try Python service first (ytmusicapi random), fallback to Bandcamp
  try {
    const track = await fetchRandomTrack();
    return Response.json(track);
  } catch {
    const track = await getRandomTechnoTrack();
    if (!track) {
      return Response.json(
        { error: "Could not fetch random track" },
        { status: 503 }
      );
    }
    return Response.json(track);
  }
}
