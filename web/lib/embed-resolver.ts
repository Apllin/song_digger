/**
 * Tries to find an embeddable player for a track.
 * Priority: Cosine.club → YTM → Bandcamp → Beatport (no embed)
 * Returns embedUrl or null.
 */

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";

interface EmbedResult {
  embedUrl: string | null;
  source: string | null;
  sourceUrl?: string | null;
  coverUrl?: string | null;
}

export async function resolveEmbed(
  title: string,
  artist: string
): Promise<EmbedResult> {
  const query = `${artist} - ${title}`;

  // Try YTM exact search (matches artist+title precisely)
  try {
    const params = new URLSearchParams({ title, artist });
    const res = await fetch(
      `${PYTHON_SERVICE_URL}/ytm/search-exact?${params}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (res.ok) {
      const data = await res.json();
      if (data.embedUrl) {
        return {
          embedUrl: data.embedUrl,
          source: "youtube_music",
          sourceUrl: data.sourceUrl ?? null,
          coverUrl: data.coverUrl ?? null,
        };
      }
    }
  } catch {
    // continue to next source
  }

  // Try Bandcamp — require both track title and at least one artist word to match
  // so we don't return a random first result from an unrelated search.
  try {
    const { searchBandcampSimilar } = await import("@/lib/scrapers/bandcamp");
    const tracks = await searchBandcampSimilar(query);
    const titleLower = title.toLowerCase();
    const artistWords = artist.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const match = tracks.find((t) => {
      if (!t.embedUrl) return false;
      const tTitle = t.title.toLowerCase();
      const tArtist = t.artist.toLowerCase();
      const titleMatch = tTitle.includes(titleLower) || titleLower.includes(tTitle);
      const artistMatch = artistWords.some(
        (w) => tArtist.includes(w) || tTitle.includes(w)
      );
      return titleMatch && artistMatch;
    });
    if (match) {
      return {
        embedUrl: match.embedUrl ?? null,
        source: "bandcamp",
        sourceUrl: match.sourceUrl ?? null,
        coverUrl: match.coverUrl,
      };
    }
  } catch {
    // continue
  }

  return { embedUrl: null, source: null };
}
