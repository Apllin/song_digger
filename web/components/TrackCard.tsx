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
}

const SOURCE_LABELS: Record<string, string> = {
  youtube_music: "YouTube Music",
  bandcamp: "Bandcamp",
  cosine_club: "Cosine.club",
  yandex_music: "Yandex.Music",
  lastfm: "Last.fm",
  trackidnet: "trackid.net",
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

  // Compare by id, not sourceUrl — for non-YTM/non-bandcamp tracks the
  // BottomPlayer swaps `sourceUrl` to a resolved YTM/Bandcamp URL while
  // keeping `id` stable, so sourceUrl comparison would falsely report
  // not-playing right after resolution.
  const isPlaying = player.track?.id === track.id;

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
      return;
    }
    // Always hand the track to the player — even when there's no embedUrl
    // and the source isn't directly playable. BottomPlayer resolves a YTM
    // or Bandcamp embed via /api/embed and swaps the active track.
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
  }, [isPlaying, track, playlist, trackIndex, player]);

  const handleFindSimilar = () => {
    const q = encodeURIComponent(`${track.artist} - ${track.title}`);
    window.open(`/?q=${q}`, "_blank");
  };

  const handleDiscography = () => {
    window.open(`/discography?artist=${encodeURIComponent(track.artist)}`, "_blank");
  };

  const sourceLabel = SOURCE_LABELS[track.source] ?? track.source;

  return (
    <div className="group flex flex-col gap-2">
      {/* Cover */}
      <div className="relative aspect-square bg-zinc-900 rounded-md overflow-hidden">
        {effectiveCover && !imgFailed ? (
          <img
            src={effectiveCover}
            alt={`${track.title} cover`}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-600">
            <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </div>
        )}

        {isPlaying && (
          <div className="absolute inset-0 ring-2 ring-indigo-500/60 pointer-events-none rounded-md" />
        )}

        <button
          onClick={handlePlay}
          className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label={isPlaying ? "Stop" : "Play"}
        >
          <svg className="w-9 h-9 text-white" fill="currentColor" viewBox="0 0 24 24">
            {isPlaying ? (
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            ) : (
              <path d="M8 5v14l11-7z" />
            )}
          </svg>
        </button>
      </div>

      {/* Info */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-start justify-between gap-1.5">
          <div className="min-w-0 flex-1">
            <p
              className="font-medium text-xs text-zinc-50 truncate"
              title={track.title}
            >
              {track.title}
            </p>
            <div className="flex items-center gap-1 min-w-0">
              <p className="text-[11px] text-zinc-400 truncate">{track.artist}</p>
              <button
                onClick={handleDiscography}
                className="shrink-0 opacity-70 hover:opacity-100 transition-opacity"
                aria-label={`${track.artist} discography`}
                title="Discography"
              >
                <Vinyl className="w-3 h-3" />
              </button>
            </div>
          </div>

          {onDislike && (
            <button
              onClick={onDislike}
              className="shrink-0 text-zinc-600 hover:text-red-500 transition-colors"
              aria-label="Not interested"
              title="Not interested"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z" />
              </svg>
            </button>
          )}

          {onFavoriteToggle && (
            <button
              onClick={() => onFavoriteToggle(track.id)}
              className={`shrink-0 transition-colors ${
                isFavorite ? "text-red-400" : "text-zinc-500 hover:text-red-400"
              }`}
              aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
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

        <a
          href={track.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-zinc-500 hover:text-zinc-200 transition-colors truncate"
        >
          Open in {sourceLabel} ↗
        </a>

        <button
          onClick={handleFindSimilar}
          className="self-start text-[11px] font-medium px-2.5 py-1 rounded-full border border-zinc-700 text-zinc-300 hover:border-zinc-300 hover:text-zinc-50 transition-colors"
          title="Find similar tracks"
        >
          Find similar
        </button>
      </div>
    </div>
  );
}

function Vinyl({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="11.5" fill="#111111" stroke="#ffffff" strokeWidth="0.5" />
      <circle cx="12" cy="12" r="10" fill="none" stroke="#2a2a2a" strokeWidth="0.3" />
      <circle cx="12" cy="12" r="8" fill="none" stroke="#2a2a2a" strokeWidth="0.3" />
      <circle cx="12" cy="12" r="6" fill="none" stroke="#2a2a2a" strokeWidth="0.3" />
      <circle cx="12" cy="12" r="3.8" fill="#dc2626" />
      <circle cx="12" cy="12" r="0.5" fill="#111111" />
    </svg>
  );
}
