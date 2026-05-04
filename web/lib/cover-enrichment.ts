// iTunes Search API as a fallback cover provider for tracks where adapters
// did not return a `coverUrl` (Last.fm/trackid.net misses, primarily). Free,
// no key, ~20 RPS soft cap on the public endpoint — we stay well below that
// with a small concurrency limit and skip the network call entirely when
// the candidate already has a cover from one of our richer sources.
//
// Returned URLs are `artworkUrl100`; iTunes serves the same artwork at
// arbitrary sizes by editing the path segment, so we rewrite to 600×600.

import type { FusedCandidate } from "@/lib/aggregator";

const ITUNES_ENDPOINT = "https://itunes.apple.com/search";
const REQUEST_TIMEOUT_MS = 1500;
const CONCURRENCY = 6;

interface ITunesResult {
  artworkUrl100?: string;
}

interface ITunesResponse {
  results?: ITunesResult[];
}

async function lookupOne(artist: string, title: string): Promise<string | null> {
  const term = `${artist} ${title}`.trim();
  if (!term) return null;
  const url = `${ITUNES_ENDPOINT}?term=${encodeURIComponent(term)}&media=music&entity=song&limit=1`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as ITunesResponse;
    const art = data.results?.[0]?.artworkUrl100;
    if (!art) return null;
    return art.replace(/\/\d+x\d+([a-z\-]*)\.(jpg|png)$/i, "/600x600$1.$2");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function enrichMissingCovers(candidates: FusedCandidate[]): Promise<void> {
  const targets = candidates.filter((t) => t.coverUrl == null);
  if (!targets.length) return;

  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const i = cursor++;
      const t = targets[i];
      const found = await lookupOne(t.artist, t.title);
      if (found) t.coverUrl = found;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
}
