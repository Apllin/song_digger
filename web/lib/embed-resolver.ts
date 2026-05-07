/**
 * Tries to find an embeddable player for a track.
 * Priority: YTM exact-match → Bandcamp.
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

/**
 * Discogs disambiguates duplicate artist names with a trailing " (N)" suffix
 * (e.g. "Voicex (2)"). YTM and Bandcamp don't share Discogs's artist IDs, so
 * the suffix is search-time noise — strip it before fan-out.
 */
function cleanArtist(artist: string): string {
  return artist.replace(/\s*\(\d+\)\s*$/, "").trim();
}

export async function resolveEmbed(
  title: string,
  artist: string
): Promise<EmbedResult> {
  const cleanedArtist = cleanArtist(artist);
  const query = `${cleanedArtist} - ${title}`;

  // Try YTM exact search (matches artist+title precisely)
  try {
    const params = new URLSearchParams({ title, artist: cleanedArtist });
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
    const artistWords = cleanedArtist.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
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
