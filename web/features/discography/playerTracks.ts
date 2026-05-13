import type { PlayerTrack } from "@/features/player/types";
import type { TracklistItem } from "@/lib/python-api/generated/types/TracklistItem";

// AlbumAccordion track IDs encode the release so the album playlist extender
// can identify which release the player is currently in. Bumping the format
// requires updating `releaseIdFromTrackId` to match.
const TRACK_PREFIX = "discography::";

interface ReleaseLike {
  id: string;
  type: string | null;
  thumb: string | null;
  source?: "discogs" | "bandcamp" | null;
  sourceUrl?: string | null;
}

export function discographyTrackId(release: ReleaseLike, index: number): string {
  return `${TRACK_PREFIX}${release.id}::${index}`;
}

export function releaseIdFromTrackId(trackId: string): string | null {
  if (!trackId.startsWith(TRACK_PREFIX)) return null;
  return trackId.slice(TRACK_PREFIX.length).split("::")[0] ?? null;
}

export function tracklistTypeOf(release: ReleaseLike): "master" | "release" {
  return release.type === "master" ? "master" : "release";
}

export function tracklistQueryKey(release: ReleaseLike) {
  const isBandcamp = release.source === "bandcamp" && !!release.sourceUrl;
  return [
    "tracklist",
    release.source ?? "discogs",
    isBandcamp ? release.sourceUrl : release.id,
    tracklistTypeOf(release),
  ] as const;
}

export function toPlayerTrack(
  item: TracklistItem,
  index: number,
  release: ReleaseLike,
  fallbackArtist: string,
): PlayerTrack {
  return {
    id: discographyTrackId(release, index),
    title: item.title,
    artist: item.artists.length > 0 ? item.artists.join(", ") : fallbackArtist,
    source: null,
    sourceUrl: "",
    coverUrl: release.thumb ?? null,
  };
}
