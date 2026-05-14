"use client";

import { useCallback, useState } from "react";

import { usePlayer } from "@/features/player/hooks/usePlayer";
import type { PlayerTrack, TrackSource } from "@/features/player/types";

const SOURCE_LABELS: Record<TrackSource, string> = {
  youtube_music: "YouTube Music",
  bandcamp: "Bandcamp",
  cosine_club: "Cosine.club",
  yandex_music: "Yandex.Music",
  lastfm: "Last.fm",
  trackidnet: "trackid.net",
  soundcloud: "Soundcloud",
};

interface TrackCardProps {
  track: PlayerTrack;
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

  const videoId = track.source === "youtube_music" ? (track.sourceUrl.split("v=")[1]?.split("&")[0] ?? null) : null;

  const effectiveCover = track.coverUrl ?? (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null);

  const handlePlay = useCallback(() => {
    if (isPlaying) {
      player.close();
      return;
    }
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
      trackIndex,
    );
  }, [isPlaying, track, playlist, trackIndex, player]);

  const handleFindSimilar = () => {
    const q = encodeURIComponent(`${track.artist} - ${track.title}`);
    window.open(`/?q=${q}`, "_blank");
  };

  const handleDiscography = () => {
    window.open(`/discography?artist=${encodeURIComponent(track.artist)}`, "_blank");
  };

  const sourceLabel = track.source ? SOURCE_LABELS[track.source] : "Unavailable";

  return (
    <div
      className="group flex flex-col gap-2 p-2.5 rounded-xl border transition-colors"
      style={{
        background: "rgba(36, 40, 60, 0.62)",
        borderColor: "rgba(255, 255, 255, 0.18)",
        boxShadow: "0 0 0 1px rgba(255,255,255,0.04) inset, 0 12px 32px rgba(0,0,0,0.35)",
        backdropFilter: "blur(16px) saturate(140%)",
        WebkitBackdropFilter: "blur(16px) saturate(140%)",
      }}
    >
      {/* Cover */}
      <div
        className="relative aspect-square rounded-lg overflow-hidden"
        style={{
          background: "linear-gradient(135deg, rgba(185,163,232,0.10), rgba(180,120,80,0.06))",
          border: "1px solid var(--td-hair)",
        }}
      >
        {effectiveCover && !imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={effectiveCover}
            alt={`${track.title} cover`}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-td-fg-m">
            <svg className="w-9 h-9" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
          </div>
        )}

        {isPlaying && (
          <div
            className="absolute inset-0 pointer-events-none rounded-lg"
            style={{ boxShadow: "inset 0 0 0 2px var(--td-accent)" }}
          />
        )}

        {/* Hover dim + play button overlay */}
        <button
          onClick={handlePlay}
          className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: "rgba(15,13,16,0.45)" }}
          aria-label={isPlaying ? "Stop" : "Play"}
        >
          <span
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{
              background: "var(--td-accent)",
              color: "var(--td-bg)",
              boxShadow: "0 0 18px var(--td-accent-soft)",
            }}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              {isPlaying ? <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /> : <path d="M8 5v14l11-7z" />}
            </svg>
          </span>
        </button>

        {/* Always-visible accent play affordance (bottom-right) */}
        <button
          onClick={handlePlay}
          className="absolute right-1.5 bottom-1.5 w-6 h-6 rounded-full flex items-center justify-center group-hover:opacity-0 transition-opacity"
          style={{
            background: "var(--td-accent)",
            color: "var(--td-bg)",
            boxShadow: "0 0 12px var(--td-accent-soft)",
          }}
          aria-label="Play"
          tabIndex={-1}
        >
          <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>

        {/* Action chips top-right — always visible */}
        <div className="absolute top-1.5 right-1.5 flex gap-1.5">
          {onFavoriteToggle && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onFavoriteToggle(track.id);
              }}
              className="w-7 h-7 rounded-full flex items-center justify-center backdrop-blur-md transition-colors"
              style={{
                background: isFavorite ? "rgba(112, 132, 255, 0.18)" : "rgba(15,13,16,0.7)",
                border: `1px solid ${isFavorite ? "#7084ff" : "rgba(255,255,255,0.18)"}`,
                color: isFavorite ? "#7084ff" : "var(--td-fg)",
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
          {onDislike && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDislike();
              }}
              className="w-7 h-7 rounded-full flex items-center justify-center backdrop-blur-md transition-colors"
              style={{
                background: "rgba(15,13,16,0.7)",
                border: "1px solid rgba(255,255,255,0.18)",
                color: "var(--td-fg)",
              }}
              aria-label="Not interested"
              title="Dislike"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.095c.5 0 .905-.405.905-.904 0-.715.211-1.413.608-2.008L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="flex flex-col gap-0.5 min-w-0">
        <p className="text-[12px] font-medium leading-tight tracking-[-0.01em] text-td-fg truncate" title={track.title}>
          {track.title}
        </p>
        <div className="flex items-center gap-1 min-w-0">
          <p className="text-[11px] text-td-fg-d truncate">{track.artist}</p>
          <button
            onClick={handleDiscography}
            className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            aria-label={`${track.artist} discography`}
            title="Discography"
            style={{ color: "var(--td-fg-m)" }}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
              <circle
                cx="12"
                cy="12"
                r="10.2"
                fill="currentColor"
                fillOpacity="0.35"
                stroke="rgba(255,255,255,0.92)"
                strokeWidth="1.4"
              />
              <circle cx="12" cy="12" r="3.6" fill="var(--td-accent)" />
              <circle cx="12" cy="12" r="0.6" fill="var(--td-bg)" />
            </svg>
          </button>
        </div>
        <a
          href={track.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono-td text-[10px] text-td-fg-m hover:text-td-accent transition-colors truncate"
        >
          {sourceLabel} ↗
        </a>
        <button
          onClick={handleFindSimilar}
          className="self-start mt-1 text-[10px] font-medium px-2 py-[3px] rounded-full border transition-colors"
          style={{
            borderColor: "var(--td-hair-2)",
            color: "var(--td-fg-d)",
          }}
          title="Find similar tracks"
        >
          Find similar
        </button>
      </div>
    </div>
  );
}
