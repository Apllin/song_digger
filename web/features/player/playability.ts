import type { PlayerTrack } from "@/features/player/types";
import { extractVideoId } from "@/features/player/ytApi";

// A "playable" source row is only actually playable if the adapter has what it
// needs. Track rows from older saves or feeds (discography/label tracklists)
// can miss these fields, and without this guard the adapter spins forever.
export function canAdapterPlay(track: PlayerTrack): boolean {
  switch (track.source) {
    case "youtube_music":
      return !!extractVideoId("youtube_music", track.sourceUrl, track.embedUrl);
    case "bandcamp":
      return !!track.sourceUrl;
    case "soundcloud":
      return !!track.embedUrl;
    default:
      return false;
  }
}

// The single source of truth for "this track must go through /api/embed before
// it can play". useAudioPlayer (the player) and useNextTrackPreload (the cache
// warmer) MUST agree on this set — if they drift, the preload warms the wrong
// tracks and the next-click handoff stalls on a live resolve. Empty title/artist
// would produce a useless lookup, so guard on those too.
export function needsEmbedResolution(track: PlayerTrack): boolean {
  return !!track.title && !!track.artist && !canAdapterPlay(track);
}
