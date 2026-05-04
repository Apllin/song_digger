import * as cheerio from "cheerio";
import type { TrackMeta } from "@/lib/python-client";
import { cachedFetch } from "@/lib/dev-cache";

async function fetchHtml(url: string): Promise<string> {
  const res = await cachedFetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`Bandcamp fetch failed: ${res.status}`);
  return res.text();
}

/**
 * Bandcamp search result URLs contain `search_item_id=TRACK_ID`.
 * This ID is used directly in the embed player URL — no extra page fetch needed.
 */
function buildEmbedUrl(trackUrl: string): string | undefined {
  const match = trackUrl.match(/search_item_id=(\d+)/);
  if (!match) return undefined;
  return `https://bandcamp.com/EmbeddedPlayer/track=${match[1]}/size=small/bgcol=000000/linkcol=4ec5ec/transparent=true/`;
}

export async function searchBandcampSimilar(
  query: string
): Promise<TrackMeta[]> {
  const encoded = encodeURIComponent(query);
  const url = `https://bandcamp.com/search?q=${encoded}&item_type=t`;

  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    const tracks: TrackMeta[] = [];

    $("li.searchresult").each((_, el) => {
      const itemType = $(el).find(".itemtype").text().trim().toLowerCase();
      if (itemType !== "track") return;

      // href contains search_item_id — use it for embed + as canonical URL
      const href = $(el).find(".heading a").attr("href") ?? "";
      const sourceUrl = $(el).find(".itemurl").text().trim();
      const title = $(el).find(".heading a").text().trim();
      const artist = $(el)
        .find(".subhead")
        .text()
        .replace(/^by\s+/i, "")
        .trim();
      const coverUrl = $(el).find(".art img").attr("src");
      const label = $(el).find(".subhead").last().text().trim();

      if (!title || !sourceUrl) return;

      tracks.push({
        title,
        artist: artist || "Unknown",
        source: "bandcamp",
        sourceUrl,
        coverUrl,
        embedUrl: buildEmbedUrl(href),
        label,
      });
    });

    return tracks.slice(0, 30);
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
export async function extractBandcampAudio(
  url: string,
): Promise<{ audioUrl: string; duration?: number } | null> {
  try {
    const html = await fetchHtml(url);
    const m =
      html.match(/mp3-128&quot;\s*:\s*&quot;(.+?)&quot;/) ??
      html.match(/"mp3-128"\s*:\s*"([^"]+)"/);
    if (!m) return null;
    const audioUrl = m[1]
      .replace(/&amp;/g, "&")
      .replace(/\\\//g, "/")
      .replace(/^http:/, "https:");
    const durM =
      html.match(/duration&quot;\s*:\s*([\d.]+)/) ??
      html.match(/"duration"\s*:\s*([\d.]+)/);
    const duration = durM ? parseFloat(durM[1]) : undefined;
    return { audioUrl, duration };
  } catch (err) {
    console.error("[Bandcamp] extract audio error:", err);
    return null;
  }
}

