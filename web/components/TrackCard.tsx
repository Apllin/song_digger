"use client";

import { useState, useCallback } from "react";
import { usePlayer, type PlayerTrack } from "@/lib/atoms/player";

interface Track {
  id: string;
  title: string;
  artist: string;
  source: string;
  sourceUrl: string;
  coverUrl?: string | null;
  embedUrl?: string | null;
  bpm?: number | null;
  key?: string | null;
  energy?: number | null;
  genre?: string | null;
  label?: string | null;
}

const SOURCE_LABELS: Record<string, string> = {
  youtube_music: "YouTube Music",
  bandcamp: "Bandcamp",
  cosine_club: "Cosine.club",
  beatport: "Beatport",
};

const SOURCE_COLORS: Record<string, string> = {
  youtube_music: "bg-red-900/60 text-red-300",
  bandcamp: "bg-sky-900/60 text-sky-300",
  cosine_club: "bg-purple-900/60 text-purple-300",
  beatport: "bg-green-900/60 text-green-300",
};

interface TrackCardProps {
  track: Track;
  playlist: PlayerTrack[];
  trackIndex: number;
  isFavorite?: boolean;
  onFavoriteToggle?: (trackId: string) => void;
  onDislike?: () => void;
}

export function TrackCard({
  track,
  playlist,
  trackIndex,
  isFavorite = false,
  onFavoriteToggle,
  onDislike,
}: TrackCardProps) {
  const player = usePlayer();
  const [imgFailed, setImgFailed] = useState(false);

  const isPlaying = player.track?.sourceUrl === track.sourceUrl;

  const videoId =
    track.source === "youtube_music"
      ? track.sourceUrl.split("v=")[1]?.split("&")[0] ?? null
      : null;

  const effectiveCover =
    track.coverUrl ??
    (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null);

  const handlePlay = useCallback(() => {
    if (isPlaying) {
      player.close();
    } else if (track.embedUrl) {
      player.play(
        {
          id: track.id,
          title: track.title,
          artist: track.artist,
          source: track.source,
          sourceUrl: track.sourceUrl,
          coverUrl: track.coverUrl,
          embedUrl: track.embedUrl,
        },
        playlist,
        trackIndex
      );
    }
  }, [isPlaying, track, playlist, trackIndex, player]);

  const handleFindSimilar = () => {
    const q = encodeURIComponent(`${track.artist} - ${track.title}`);
    window.open(`/?q=${q}`, "_blank");
  };

  const handleDiscography = () => {
    window.open(`/discography?artist=${encodeURIComponent(track.artist)}`, "_blank");
  };

  const sourceBadge = SOURCE_COLORS[track.source] ?? "bg-zinc-700 text-zinc-300";

  return (
    <div
      className={`group relative flex flex-col bg-zinc-900 border rounded-xl overflow-hidden transition-colors ${
        isPlaying ? "border-indigo-500/60" : "border-zinc-800 hover:border-zinc-600"
      }`}
    >
      {/* Cover */}
      <div className="relative aspect-square bg-zinc-800">
        {effectiveCover && !imgFailed ? (
          <img
            src={effectiveCover}
            alt={`${track.title} cover`}
            className="w-full h-full object-cover"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-600">
            <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </div>
        )}

        {/* Now-playing pulse ring */}
        {isPlaying && (
          <div className="absolute inset-0 ring-2 ring-indigo-500/60 pointer-events-none rounded-none" />
        )}

        {/* Play/stop overlay */}
        {track.embedUrl && (
          <button
            onClick={handlePlay}
            className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label={isPlaying ? "Stop" : "Play"}
          >
            {isPlaying ? (
              <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
        )}
      </div>

      {/* Info */}
      <div className="flex flex-col gap-1 p-3 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm text-zinc-100 truncate" title={track.title}>
              {track.title}
            </p>
            <div className="flex items-center gap-1 min-w-0">
              <p className="text-xs text-zinc-400 truncate">{track.artist}</p>
              <button
                onClick={handleDiscography}
                className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors"
                aria-label="View discography"
                title="View discography"
              >
                {/* Vinyl record icon */}
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Dislike button */}
          {onDislike && (
            <button
              onClick={onDislike}
              className="shrink-0 text-zinc-600 hover:text-red-500 transition-colors"
              aria-label="Not interested"
              title="Not interested"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/>
              </svg>
            </button>
          )}

          {/* Favorite button */}
          {onFavoriteToggle && (
            <button
              onClick={() => onFavoriteToggle(track.id)}
              className="shrink-0 text-zinc-500 hover:text-red-400 transition-colors"
              aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
            >
              <svg
                className="w-4 h-4"
                fill={isFavorite ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                />
              </svg>
            </button>
          )}
        </div>

        {/* Tags row */}
        <div className="flex flex-wrap gap-1 mt-1">
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${sourceBadge}`}>
            {SOURCE_LABELS[track.source] ?? track.source}
          </span>

          {track.bpm && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
              {Math.round(track.bpm)} BPM
            </span>
          )}

          {track.key && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-emerald-400 font-mono">
              {track.key}
            </span>
          )}

          {track.genre && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
              {track.genre}
            </span>
          )}
        </div>

        {/* Bottom row: open link + find similar */}
        <div className="flex items-center justify-between mt-2 gap-2">
          <a
            href={track.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors truncate"
          >
            Open on {SOURCE_LABELS[track.source] ?? track.source} ↗
          </a>

          <button
            onClick={handleFindSimilar}
            className="shrink-0 flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-zinc-800 text-indigo-400 hover:bg-zinc-700 hover:text-indigo-300 transition-colors"
            title="Find similar tracks"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            Similar
          </button>
        </div>
      </div>
    </div>
  );
}
