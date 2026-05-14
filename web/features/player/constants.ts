import type { TrackSource } from "./types";

export const PLAYABLE_SOURCES = new Set<TrackSource>(["youtube_music", "bandcamp", "soundcloud"]);

export const SOURCE_LABELS: Partial<Record<TrackSource, string>> = {
  youtube_music: "YouTube Music",
  bandcamp: "Bandcamp",
  cosine_club: "Cosine.club",
  yandex_music: "Yandex Music",
  trackidnet: "trackid.net",
  soundcloud: "SoundCloud",
};
