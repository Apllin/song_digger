"use client";

import type { DiscographyTrack } from "@/features/player/types";

interface TrackRowProps {
  track: DiscographyTrack;
  isPlaying: boolean;
  onPlay: () => void;
}

export function TrackRow({ track, isPlaying, onPlay }: TrackRowProps) {
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
    </div>
  );
}
