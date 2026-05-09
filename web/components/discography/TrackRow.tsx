"use client";

import { useEffect, useState } from "react";

import { EmbedPlayer } from "@/features/player/components/EmbedPlayer";
import type { DiscographyTrack } from "@/features/player/types";

interface TrackRowProps {
  track: DiscographyTrack;
  /** Controlled play state — when provided, the parent owns open/close */
  isPlaying?: boolean;
  onPlayToggle?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}

interface EmbedResult {
  embedUrl: string | null;
  source: string | null;
  sourceUrl?: string | null;
  coverUrl?: string | null;
}

export function TrackRow({ track, isPlaying, onPlayToggle, onPrev, onNext }: TrackRowProps) {
  const [embedResult, setEmbedResult] = useState<EmbedResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [internalShow, setInternalShow] = useState(false);

  const controlled = onPlayToggle !== undefined;
  const showEmbed = controlled ? (isPlaying ?? false) : internalShow;

  const artist = track.artists.length > 0 ? track.artists.join(", ") : (track.albumArtist ?? "");

  async function fetchEmbed(): Promise<EmbedResult | null> {
    if (embedResult) return embedResult;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/embed?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(artist)}`,
      );
      const data: EmbedResult = await res.json();
      setEmbedResult(data);
      return data;
    } finally {
      setLoading(false);
    }
  }

  // When controlled parent sets isPlaying=true, auto-fetch embed
  useEffect(() => {
    if (controlled && isPlaying && !embedResult && !loading) {
      fetchEmbed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  async function handlePlay() {
    if (showEmbed) {
      if (controlled) onPlayToggle?.();
      else setInternalShow(false);
      return;
    }
    const data = await fetchEmbed();
    if (data?.embedUrl) {
      if (controlled) onPlayToggle?.();
      else setInternalShow(true);
    }
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800/50 group transition-colors">
        {/* Position */}
        <span className="w-6 text-center text-xs text-zinc-600 shrink-0">{track.position}</span>

        {/* Play button */}
        <button
          onClick={handlePlay}
          disabled={loading}
          className="w-7 h-7 shrink-0 flex items-center justify-center rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100 transition-colors disabled:opacity-50"
          aria-label={showEmbed ? "Close player" : "Play"}
        >
          {loading ? (
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : showEmbed ? (
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Title + artist */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-zinc-200 truncate">{track.title}</p>
          {artist && <p className="text-xs text-zinc-500 truncate">{artist}</p>}
        </div>

        {/* Duration */}
        {track.duration && <span className="text-xs text-zinc-600 shrink-0">{track.duration}</span>}

        {/* No embed badge */}
        {embedResult && !embedResult.embedUrl && <span className="text-[10px] text-zinc-600 shrink-0">no player</span>}
      </div>

      {/* Inline embed */}
      {showEmbed && embedResult?.embedUrl && embedResult.source && (
        <div className="px-3 pb-1">
          <EmbedPlayer
            source={embedResult.source}
            embedUrl={embedResult.embedUrl}
            title={track.title}
            artist={artist}
            sourceUrl={
              embedResult.sourceUrl ??
              `https://music.youtube.com/search?q=${encodeURIComponent(artist + " " + track.title)}`
            }
            onPrev={onPrev}
            onNext={onNext}
          />
        </div>
      )}
    </div>
  );
}
