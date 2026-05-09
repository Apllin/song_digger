"use client";

import { useEffect, useState } from "react";
import { PlayerProgressBar } from "./PlayerProgressBar";

import { SOURCE_LABELS } from "@/features/player/constants";
import { useAudioPlayer } from "@/features/player/hooks/useAudioPlayer";
import { useMediaSession } from "@/features/player/hooks/useMediaSession";
import { usePlayer } from "@/features/player/hooks/usePlayer";

export function BottomPlayer() {
  const { track, playingIndex, playlist, close, playNext, playPrev, swapTrack } = usePlayer();

  const [coverFailed, setCoverFailed] = useState(false);

  const player = useAudioPlayer({ track, onEnded: playNext, swapTrack });
  const { playing, currentTime, duration, isReady, toggle, seekTo, volume, setVolume } = player;

  const isPlayable = player.source !== null;
  const resolving = track !== null && player.source === null && track.source !== "unavailable";

  // Narrow source-specific DOM fields to plain local variables to satisfy the
  // lint rule that disallows ref-containing object property access in JSX.
  const videoId = player.source === "youtube_music" ? player.videoId : null;
  const audioRef = player.source === "bandcamp" ? player.audioRef : null;
  const audioUrl = player.source === "bandcamp" ? player.audioUrl : null;
  const audioEventHandlers = player.source === "bandcamp" ? player.audioEventHandlers : undefined;

  useMediaSession({
    track,
    playing,
    currentTime,
    duration,
    playingIndex,
    playlist,
    playNext,
    playPrev,
    audioRef,
  });

  useEffect(() => {
    setCoverFailed(false);
  }, [track?.id]);

  // Spacebar globally toggles play/pause — skip when typing into inputs.
  useEffect(() => {
    if (!track) return;
    const handler = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      const t = e.target as HTMLElement | null;
      if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.isContentEditable) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // toggle reads live state from refs/player API — only rebind when track changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id]);

  const hasPrev = playingIndex !== null && playingIndex > 0;
  const hasNext = playingIndex !== null && playingIndex < playlist.length - 1;
  const coverUrl = track?.coverUrl ?? (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null);

  if (!track) return null;

  return (
    <div
      className="fixed bottom-4 left-4 right-4 md:left-7 md:right-7 z-50 max-w-6xl md:mx-auto rounded-[18px] backdrop-blur-xl shadow-2xl"
      style={{
        background: "rgba(20,18,26,0.85)",
        border: "1px solid var(--td-hair-2)",
      }}
    >
      {/* Hidden Bandcamp audio — direct mp3 stream extracted from the source page. */}
      {audioUrl && <audio ref={audioRef} src={audioUrl} autoPlay {...audioEventHandlers} />}

      <div className="px-4 py-2 flex flex-col gap-1.5">
        {/* Main row */}
        <div className="flex items-center gap-3">
          {/* Cover thumbnail */}
          {coverUrl && !coverFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverUrl}
              alt=""
              className="w-9 h-9 rounded-lg object-cover shrink-0"
              style={{ border: "1px solid var(--td-hair)" }}
              onError={() => setCoverFailed(true)}
            />
          ) : (
            <div
              className="w-9 h-9 rounded-lg shrink-0 relative overflow-hidden"
              style={{
                background: "linear-gradient(135deg, rgba(185,163,232,0.35), rgba(58,36,64,0.6))",
              }}
            >
              <div
                className="absolute inset-0"
                style={{
                  background: "radial-gradient(circle at 70% 30%, var(--td-accent-soft), transparent 50%)",
                }}
              />
            </div>
          )}

          {/* Track info */}
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-td-fg truncate">{track.title}</p>
            <p className="text-caption text-td-fg-m truncate">
              {track.artist}
              <span className="ml-2" style={{ color: "var(--td-fg-m)" }}>
                · {resolving ? "Finding playable source…" : (SOURCE_LABELS[track.source] ?? track.source)}
              </span>
            </p>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={playPrev}
              disabled={!hasPrev}
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors disabled:opacity-30"
              style={{ color: "var(--td-fg-d)" }}
              aria-label="Previous"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
              </svg>
            </button>

            {isPlayable && (
              <button
                onClick={toggle}
                disabled={!isReady}
                className="w-8.5 h-8.5 flex items-center justify-center rounded-full transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{
                  background: "var(--td-accent)",
                  color: "var(--td-bg)",
                  boxShadow: "0 0 18px var(--td-accent-soft)",
                }}
                aria-label={playing ? "Pause" : "Play"}
              >
                {!isReady ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                ) : playing ? (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
            )}

            <button
              onClick={playNext}
              disabled={!hasNext}
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors disabled:opacity-30"
              style={{ color: "var(--td-fg-d)" }}
              aria-label="Next"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 18l8.5-6L6 6v12zm2-8.14 5.51 3.86L8 17.14V9.86z" />
                <path d="M16 6h2v12h-2z" />
              </svg>
            </button>

            {/* Volume (YouTube + Bandcamp) */}
            {isPlayable && (
              <div className="flex items-center gap-1.5 ml-1">
                <button
                  onClick={() => setVolume(volume === 0 ? 100 : 0)}
                  className="w-7 h-7 flex items-center justify-center transition-colors shrink-0"
                  style={{ color: "var(--td-fg-d)" }}
                  aria-label={volume === 0 ? "Unmute" : "Mute"}
                >
                  {volume === 0 ? (
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M16.5 12A4.5 4.5 0 0014 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06A8.99 8.99 0 0017.73 18l2 2L21 18.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                    </svg>
                  ) : volume < 50 ? (
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M18.5 12A4.5 4.5 0 0016 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                    </svg>
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  aria-label="Volume"
                  className="w-20 h-1 cursor-pointer"
                  style={{ accentColor: "var(--td-accent)" }}
                />
              </div>
            )}

            {/* Open on source */}
            <a
              href={
                track.source === "youtube_music" && videoId
                  ? `https://www.youtube.com/watch?v=${videoId}`
                  : track.sourceUrl
              }
              target="_blank"
              rel="noopener noreferrer"
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
              style={{ color: "var(--td-fg-d)" }}
              aria-label="Open on source"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </a>

            {/* Close */}
            <button
              onClick={close}
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
              style={{ color: "var(--td-fg-m)" }}
              aria-label="Close player"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Progress bar (YouTube + Bandcamp) */}
        {isPlayable && (
          <PlayerProgressBar currentTime={currentTime} duration={duration} onSeek={(pct) => seekTo(pct * duration)} />
        )}
      </div>
    </div>
  );
}
