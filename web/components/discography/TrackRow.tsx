"use client";

import type { DiscographyTrack } from "@/features/player/types";

interface TrackRowProps {
  track: DiscographyTrack;
  isPlaying: boolean;
  onPlay: () => void;
  isFavorite?: boolean;
  onFavoriteToggle?: () => void;
}

export function TrackRow({ track, isPlaying, onPlay, isFavorite = false, onFavoriteToggle }: TrackRowProps) {
  const artist = track.artists.length > 0 ? track.artists.join(", ") : (track.albumArtist ?? "");

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800/50 group transition-colors">
      <span className="w-6 text-center text-xs text-zinc-600 shrink-0">{track.position}</span>

      <button
        onClick={onPlay}
        className="w-7 h-7 shrink-0 flex items-center justify-center rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 transition-colors"
        aria-label="Play"
      >
        {isPlaying ? (
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-zinc-200 truncate">{track.title}</p>
        {artist && <p className="text-xs text-zinc-500 truncate">{artist}</p>}
      </div>

      {track.duration && <span className="text-xs text-zinc-600 shrink-0">{track.duration}</span>}

      {onFavoriteToggle && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFavoriteToggle();
          }}
          className="w-7 h-7 shrink-0 flex items-center justify-center rounded-full transition-colors"
          style={{
            background: isFavorite ? "rgba(112, 132, 255, 0.18)" : "transparent",
            border: `1px solid ${isFavorite ? "#7084ff" : "rgba(255,255,255,0.10)"}`,
            color: isFavorite ? "#7084ff" : "var(--td-fg-m)",
          }}
          aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
          title={isFavorite ? "Remove from favorites" : "Like"}
        >
          <svg
            className="w-3.5 h-3.5"
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
  );
}
