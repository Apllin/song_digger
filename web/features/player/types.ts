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

// Registered by paginated playlist owners (e.g. search, discography).
// When the player reaches the end of its playlist, it calls `onEnd` and passes
// `appendAndAdvance` — a function the handler invokes with the next batch of
// tracks. Registering null signals there is nothing more to load.
export interface PlaylistEndHandler {
  onEnd(appendAndAdvance: (tracks: PlayerTrack[]) => void): void;
}

export interface DiscographyTrack {
  position: string;
  title: string;
  duration: string;
  artists: string[];
  albumArtist?: string;
  albumCover?: string | null;
}
