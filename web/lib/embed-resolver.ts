/**
 * Tries to find an embeddable player for a track.
 * Priority: YTM exact-match → Bandcamp search.
 *
 * Bandcamp here is a player-only fallback: ADR-0023 removed the Bandcamp
 * `/similar` adapter, but kept the Bandcamp search + mp3 extraction surface
 * so non-YTM tracks (yandex/lastfm/cosine/trackid) that YTM exact-match
 * can't resolve still get a chance at inline playback before falling
 * through to "unavailable".
 *
 * Returns embedUrl or null.
 */

import { searchExactYtmSearchExactGet } from "@/lib/python-api/generated/clients/searchExactYtmSearchExactGet";

interface EmbedResult {
  embedUrl: string | null;
  source: "youtube_music" | "bandcamp" | null;
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

async function tryYtmExact(title: string, cleanedArtist: string): Promise<EmbedResult | null> {
  try {
    const data = await searchExactYtmSearchExactGet(
      { title, artist: cleanedArtist },
      { signal: AbortSignal.timeout(8000) },
    );
    const embedUrl = typeof data.embedUrl === "string" ? data.embedUrl : null;
    if (!embedUrl) return null;
    return {
      embedUrl,
      source: "youtube_music",
      sourceUrl: typeof data.sourceUrl === "string" ? data.sourceUrl : null,
      coverUrl: typeof data.coverUrl === "string" ? data.coverUrl : null,
    };
  } catch {
    return null;
  }
}

async function tryBandcamp(title: string, cleanedArtist: string): Promise<EmbedResult | null> {
  try {
    const { searchBandcampSimilar } = await import("@/lib/scrapers/bandcamp");
    const query = `${cleanedArtist} - ${title}`;
    const tracks = await searchBandcampSimilar(query);
    const titleLower = title.toLowerCase();
    const artistWords = cleanedArtist
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    const match = tracks.find((t) => {
      if (!t.embedUrl) return false;
      const tTitle = t.title.toLowerCase();
      const tArtist = t.artist.toLowerCase();
      const titleMatch = tTitle.includes(titleLower) || titleLower.includes(tTitle);
      const artistMatch = artistWords.some((w) => tArtist.includes(w) || tTitle.includes(w));
      return titleMatch && artistMatch;
    });
    if (!match) return null;
    return {
      embedUrl: match.embedUrl ?? null,
      source: "bandcamp",
      sourceUrl: match.sourceUrl ?? null,
      coverUrl: match.coverUrl,
    };
  } catch {
    return null;
  }
}

export async function resolveEmbed(title: string, artist: string): Promise<EmbedResult> {
  const cleanedArtist = cleanArtist(artist);

  const ytm = await tryYtmExact(title, cleanedArtist);
  if (ytm) return ytm;

  const bc = await tryBandcamp(title, cleanedArtist);
  return bc ?? { embedUrl: null, source: null };
}
