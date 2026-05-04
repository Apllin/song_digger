import { cachedFetch } from "@/lib/dev-cache";

const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";

export interface TrackMeta {
  title: string;
  artist: string;
  source: string;
  sourceUrl: string;
  coverUrl?: string;
  embedUrl?: string;
  score?: number;
}

export interface SimilarRequest {
  input: string;          // raw query string
  artist: string;         // parsed artist
  track?: string | null;  // parsed track (null = artist-only mode)
  limit_per_source: number;
}

export interface SourceList {
  source: string;
  tracks: TrackMeta[];
}

export interface SimilarResponse {
  source_lists: SourceList[];
  source_artist: string | null;
}

export async function fetchSimilarTracks(
  req: SimilarRequest
): Promise<SimilarResponse> {
  const res = await cachedFetch(`${PYTHON_SERVICE_URL}/similar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    throw new Error(
      `Python service error: ${res.status} ${await res.text()}`
    );
  }

  return res.json();
}

export async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${PYTHON_SERVICE_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
