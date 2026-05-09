"use client";

import { useEffect, useRef, useState } from "react";

import { loadYTApi, type YTPlayer } from "@/features/player/ytApi";

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// ─── Props ────────────────────────────────────────────────────────────────────
export interface EmbedPlayerProps {
  source: string;
  embedUrl: string;
  title: string;
  artist: string;
  sourceUrl: string;
  onPrev?: () => void;
  onNext?: () => void;
}

// ─── Shared bar UI ────────────────────────────────────────────────────────────
interface BarProps {
  title: string;
  artist: string;
  sourceUrl: string;
  playing: boolean;
  ready: boolean;
  sourceIcon: "youtube" | "bandcamp" | "generic";
  currentTime: number;
  duration: number;
  onToggle: () => void;
  onSeek: (pct: number) => void;
  onPrev?: () => void;
  onNext?: () => void;
  volume?: number;
  onVolumeChange?: (v: number) => void;
  children?: React.ReactNode;
}

function PlayerBar({
  title,
  artist,
  sourceUrl,
  playing,
  ready,
  sourceIcon,
  currentTime,
  duration,
  onToggle,
  onSeek,
  onPrev,
  onNext,
  volume,
  onVolumeChange,
  children,
}: BarProps) {
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(pct);
  };

  return (
    <div className="relative flex flex-col bg-zinc-800 border border-zinc-700 rounded-xl px-3 pt-2 pb-2.5 mt-1 gap-1.5">
      {children}

      {/* Title + controls row */}
      <div className="flex items-center gap-2">
        {/* Title + artist */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-zinc-100 truncate leading-tight">{title}</p>
          <p className="text-[10px] text-zinc-500 truncate leading-tight">{artist}</p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-0.5 shrink-0">
          {onPrev && (
            <button
              onClick={onPrev}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
              aria-label="Previous"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
              </svg>
            </button>
          )}

          <button
            onClick={onToggle}
            disabled={!ready}
            className="w-8 h-8 mx-0.5 flex items-center justify-center rounded-full bg-zinc-700 hover:bg-zinc-600 text-zinc-100 transition-colors disabled:opacity-40"
            aria-label={playing ? "Pause" : "Play"}
          >
            {!ready ? (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            ) : playing ? (
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {onNext && (
            <button
              onClick={onNext}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
              aria-label="Next"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 18l8.5-6L6 6v12zm2-8.14 5.51 3.86L8 17.14V9.86z" />
                <path d="M16 6h2v12h-2z" />
              </svg>
            </button>
          )}

          {/* Volume slider (optional — shown when onVolumeChange is provided) */}
          {onVolumeChange !== undefined && volume !== undefined && (
            <div className="flex items-center gap-1 ml-0.5">
              <button
                onClick={() => onVolumeChange(volume === 0 ? 80 : 0)}
                className="w-6 h-6 flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
                aria-label={volume === 0 ? "Unmute" : "Mute"}
              >
                {volume === 0 ? (
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M16.5 12A4.5 4.5 0 0014 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06A8.99 8.99 0 0017.73 18l2 2L21 18.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                  </svg>
                ) : volume < 50 ? (
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M18.5 12A4.5 4.5 0 0016 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" />
                  </svg>
                ) : (
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
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
                onChange={(e) => onVolumeChange(Number(e.target.value))}
                aria-label="Volume"
                className="w-16 h-1 accent-zinc-400 cursor-pointer"
              />
            </div>
          )}

          {/* Source link */}
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors"
            aria-label="Open on source"
          >
            {sourceIcon === "youtube" ? (
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.818V8.432L15.818 12l-6.273 3.568z" />
              </svg>
            ) : sourceIcon === "bandcamp" ? (
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M0 18.75l7.437-13.5H24l-7.438 13.5z" />
              </svg>
            ) : (
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            )}
          </a>
        </div>
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-zinc-600 tabular-nums w-7 shrink-0 text-right">
          {formatTime(currentTime)}
        </span>
        <div
          role="slider"
          aria-label="Seek"
          aria-valuenow={Math.round(currentTime)}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          className="flex-1 h-1.5 bg-zinc-700 rounded-full cursor-pointer relative group/bar"
          onClick={handleBarClick}
        >
          <div
            className="h-full bg-zinc-400 group-hover/bar:bg-zinc-200 rounded-full transition-colors relative"
            style={{ width: `${progressPct}%` }}
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-zinc-100 rounded-full opacity-0 group-hover/bar:opacity-100 transition-opacity shadow" />
          </div>
        </div>
        <span className="text-[10px] text-zinc-600 tabular-nums w-7 shrink-0">{formatTime(duration)}</span>
      </div>
    </div>
  );
}

// ─── YouTube player ───────────────────────────────────────────────────────────
function YouTubePlayer({ embedUrl, title, artist, sourceUrl, onPrev, onNext }: Omit<EmbedPlayerProps, "source">) {
  const holderRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(80);

  const videoId = embedUrl.split("/embed/")[1]?.split("?")[0] ?? "";

  useEffect(() => {
    if (!videoId) return;
    let destroyed = false;
    loadYTApi().then(() => {
      if (destroyed || !holderRef.current || !window.YT) return;
      playerRef.current = new window.YT.Player(holderRef.current, {
        videoId,
        width: 1,
        height: 1,
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, modestbranding: 1 },
        events: {
          onReady: (e: { target: YTPlayer }) => {
            if (destroyed) return;
            setReady(true);
            setDuration(e.target.getDuration());
            e.target.setVolume(80);
          },
          onStateChange: (e: { data: number }) => {
            if (destroyed) return;
            setPlaying(e.data === 1);
          },
        },
      });
    });
    return () => {
      destroyed = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [videoId]);

  // Poll current time while playing
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const ct = playerRef.current?.getCurrentTime();
      if (ct !== undefined) setCurrentTime(ct);
      // Refresh duration in case it wasn't available at onReady
      const dur = playerRef.current?.getDuration();
      if (dur && dur > 0) setDuration(dur);
    }, 500);
    return () => clearInterval(id);
  }, [playing]);

  const toggle = () => {
    if (!playerRef.current) return;
    if (playing) playerRef.current.pauseVideo();
    else playerRef.current.playVideo();
  };

  const seek = (pct: number) => {
    if (!playerRef.current || duration <= 0) return;
    const t = pct * duration;
    playerRef.current.seekTo(t, true);
    setCurrentTime(t);
  };

  const handleVolumeChange = (v: number) => {
    setVolume(v);
    playerRef.current?.setVolume(v);
  };

  return (
    <PlayerBar
      title={title}
      artist={artist}
      sourceUrl={sourceUrl}
      playing={playing}
      ready={ready}
      sourceIcon="youtube"
      currentTime={currentTime}
      duration={duration}
      onToggle={toggle}
      onSeek={seek}
      onPrev={onPrev}
      onNext={onNext}
      volume={volume}
      onVolumeChange={handleVolumeChange}
    >
      <div
        ref={holderRef}
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          opacity: 0,
          pointerEvents: "none",
        }}
      />
    </PlayerBar>
  );
}

// ─── Bandcamp player ──────────────────────────────────────────────────────────
// Mirrors BottomPlayer's Bandcamp path: extract a streamable mp3 from the
// source page via /api/bandcamp-audio and drive playback through a hidden
// <audio> element so transport / seek / volume live in our PlayerBar.
function BandcampPlayer({ title, artist, sourceUrl, onPrev, onNext }: Omit<EmbedPlayerProps, "source">) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(80);

  useEffect(() => {
    if (!sourceUrl) return;
    let cancelled = false;
    setAudioUrl(null);
    setCurrentTime(0);
    setDuration(0);
    fetch(`/api/bandcamp-audio?url=${encodeURIComponent(sourceUrl)}`)
      .then(async (r) => {
        if (!r.ok) {
          console.error("[Bandcamp] /api/bandcamp-audio failed:", r.status, await r.text().catch(() => ""));
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (cancelled || !data?.audioUrl) return;
        setAudioUrl(data.audioUrl as string);
        if (typeof data.duration === "number") setDuration(data.duration);
      })
      .catch((err) => console.error("[Bandcamp] audio fetch error:", err));
    return () => {
      cancelled = true;
    };
  }, [sourceUrl]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch((err) => console.error("[Bandcamp] play() rejected:", err));
    else a.pause();
  };

  const seek = (pct: number) => {
    if (!audioRef.current || duration <= 0) return;
    const t = pct * duration;
    audioRef.current.currentTime = t;
    setCurrentTime(t);
  };

  const handleVolumeChange = (v: number) => {
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v / 100;
  };

  return (
    <PlayerBar
      title={title}
      artist={artist}
      sourceUrl={sourceUrl}
      playing={playing}
      ready={!!audioUrl}
      sourceIcon="bandcamp"
      currentTime={currentTime}
      duration={duration}
      onToggle={toggle}
      onSeek={seek}
      onPrev={onPrev}
      onNext={onNext}
      volume={volume}
      onVolumeChange={handleVolumeChange}
    >
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          autoPlay
          onLoadedMetadata={(e) => {
            const a = e.currentTarget;
            if (a.duration && isFinite(a.duration)) setDuration(a.duration);
            a.volume = volume / 100;
          }}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => onNext?.()}
          onError={(e) => {
            const err = e.currentTarget.error;
            console.error("[Bandcamp] <audio> error:", err?.code, err?.message, "src=", e.currentTarget.src);
          }}
          style={{ display: "none" }}
        />
      )}
    </PlayerBar>
  );
}

// ─── Public export ────────────────────────────────────────────────────────────
export function EmbedPlayer(props: EmbedPlayerProps) {
  if (props.source === "youtube_music") return <YouTubePlayer {...props} />;
  if (props.source === "bandcamp") return <BandcampPlayer {...props} />;
  return (
    <iframe
      src={props.embedUrl}
      className="w-full border-0 rounded-lg mt-1 h-14"
      allow="autoplay"
      title={props.title}
    />
  );
}
