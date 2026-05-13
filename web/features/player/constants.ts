import type { TrackSource } from "./types";

export const PLAYABLE_SOURCES = new Set<TrackSource>(["youtube_music", "bandcamp"]);

export const SOURCE_LABELS: Partial<Record<TrackSource, string>> = {
  youtube_music: "YouTube Music",
  bandcamp: "Bandcamp",
  cosine_club: "Cosine.club",
};
