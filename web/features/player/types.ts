import { z } from "zod";

export interface PlayerAdapter {
  playing: boolean;
  currentTime: number;
  duration: number;
  isReady: boolean;
  toggle(): void;
  seekTo(t: number): void;
}

export const TrackSourceSchema = z.enum([
  "youtube_music",
  "bandcamp",
  "cosine_club",
  "lastfm",
  "yandex_music",
  "trackidnet",
  "soundcloud",
  "discogs",
]);
export type TrackSource = z.infer<typeof TrackSourceSchema>;

export interface PlayerTrack {
  id: string;
  title: string;
  artist: string;
  source: TrackSource | null;
  sourceUrl: string;
  coverUrl?: string | null;
  embedUrl?: string | null;
}

// Registered by paginated playlist owners (e.g. search) so that `playNext`
// past the end of the current playlist can pull in the next page of tracks
// instead of stalling on hasNext=false.
export interface PlaylistExtender {
  hasMore: boolean;
  loadMore: () => Promise<PlayerTrack[]>;
}

export interface DiscographyTrack {
  position: string;
  title: string;
  duration: string;
  artists: string[];
  albumArtist?: string;
  albumCover?: string | null;
}
