export interface PlayerAdapter {
  playing: boolean;
  currentTime: number;
  duration: number;
  isReady: boolean;
  toggle(): void;
  seekTo(t: number): void;
}

export type TrackSource = "youtube_music" | "bandcamp" | "cosine_club" | "lastfm";

export interface PlayerTrack {
  id: string;
  title: string;
  artist: string;
  source: TrackSource | null;
  sourceUrl: string;
  coverUrl?: string | null;
  embedUrl?: string | null;
}

export interface DiscographyTrack {
  position: string;
  title: string;
  duration: string;
  artists: string[];
  albumArtist?: string;
  albumCover?: string | null;
}
