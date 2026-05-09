import { cachedFetch } from "@/lib/dev-cache";
import type { TrackMeta } from "@/lib/python-api/generated/types/TrackMeta";

async function fetchHtml(url: string): Promise<string> {
  const res = await cachedFetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`Bandcamp fetch failed: ${res.status}`);
  return res.text();
}

interface BcSearchResult {
  type: string;
  id: number;
  name: string;
  band_name: string;
  item_url_path: string;
  img?: string | null;
}

const BC_SEARCH_API = "https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic";

/**
 * Bandcamp's HTML /search page is gated by an anti-bot JS challenge.
 * The undocumented JSON autocomplete API still works and returns the
 * track id directly (no need to parse search_item_id out of an href).
 */
export async function searchBandcampSimilar(query: string): Promise<TrackMeta[]> {
  try {
    const res = await fetch(BC_SEARCH_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
      body: JSON.stringify({
        search_text: query,
        search_filter: "t",
        full_page: true,
        fan_id: null,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) throw new Error(`Bandcamp search failed: ${res.status}`);

    const json = (await res.json()) as { auto?: { results?: BcSearchResult[] } };
    const results = json.auto?.results ?? [];

    return results
      .filter((r) => r.type === "t" && r.name && r.item_url_path)
      .slice(0, 30)
      .map((r) => ({
        title: r.name,
        artist: r.band_name || "Unknown",
        source: "bandcamp",
        sourceUrl: r.item_url_path,
        coverUrl: r.img ?? undefined,
        embedUrl: `https://bandcamp.com/EmbeddedPlayer/track=${r.id}/size=small/bgcol=000000/linkcol=4ec5ec/transparent=true/`,
      }));
  } catch (err) {
    console.error("[Bandcamp] search error:", err);
    return [];
  }
}

/**
 * Extracts the streamable mp3 URL from a Bandcamp track or album page.
 * Bandcamp embeds track data in `data-tralbum="..."` as HTML-entity-encoded
 * JSON (`&quot;` not `"`); picks the first track's stream when given an
 * album page. URLs carry a short-lived token, so refetch each time.
 */
export async function extractBandcampAudio(url: string): Promise<{ audioUrl: string; duration?: number } | null> {
  try {
    const html = await fetchHtml(url);
    const m = html.match(/mp3-128&quot;\s*:\s*&quot;(.+?)&quot;/) ?? html.match(/"mp3-128"\s*:\s*"([^"]+)"/);
    if (!m) return null;
    const audioUrl = m[1]
      .replace(/&amp;/g, "&")
      .replace(/\\\//g, "/")
      .replace(/^http:/, "https:");
    const durM = html.match(/duration&quot;\s*:\s*([\d.]+)/) ?? html.match(/"duration"\s*:\s*([\d.]+)/);
    const duration = durM ? parseFloat(durM[1]) : undefined;
    return { audioUrl, duration };
  } catch (err) {
    console.error("[Bandcamp] extract audio error:", err);
    return null;
  }
}
