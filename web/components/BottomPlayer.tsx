"use client";

import { useEffect, useRef, useState } from "react";
import { usePlayer } from "@/lib/atoms/player";
import { loadYTApi, type YTPlayer } from "@/lib/yt-api";

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const SOURCE_LABELS: Record<string, string> = {
  youtube_music: "YouTube Music",
  bandcamp: "Bandcamp",
  cosine_club: "Cosine.club",
};

// ─── Component ────────────────────────────────────────────────────────────────
export function BottomPlayer() {
  const { track, playingIndex, playlist, close, playNext, playPrev } = usePlayer();

  const holderRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const currentVideoIdRef = useRef<string | null>(null);
  const bcAudioRef = useRef<HTMLAudioElement>(null);

  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(100);
  const [bcAudioUrl, setBcAudioUrl] = useState<string | null>(null);

  const changeVolume = (v: number) => {
    setVolumeState(v);
    if (track?.source === "youtube_music") {
      playerRef.current?.setVolume(v);
    } else if (track?.source === "bandcamp" && bcAudioRef.current) {
      bcAudioRef.current.volume = v / 100;
    }
  };

  const bcToggle = () => {
    const a = bcAudioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch((err) => console.error("[Bandcamp] play() rejected:", err));
    else a.pause();
  };

  // Extract YT videoId
  const videoId =
    track?.source === "youtube_music"
      ? (track.sourceUrl.split("v=")[1]?.split("&")[0] ?? null)
      : track?.embedUrl
      ? (track.embedUrl.split("/embed/")[1]?.split("?")[0] ?? null)
      : null;

  // When track changes: load new video or reset state
  useEffect(() => {
    if (!track) {
      playerRef.current?.destroy();
      playerRef.current = null;
      currentVideoIdRef.current = null;
      setPlaying(false);
      setReady(false);
      setCurrentTime(0);
      setDuration(0);
      return;
    }

    // Non-YT source: pause the YT iframe (don't destroy — YT.Player replaces
    // the holder div with an iframe and doesn't restore it on destroy(), so a
    // later re-init lands in a detached node with no audio). Reset transport
    // state so the bandcamp <audio> drives it cleanly.
    if (track.source !== "youtube_music") {
      try { playerRef.current?.pauseVideo(); } catch {}
      setPlaying(false);
      setReady(false);
      setCurrentTime(0);
      setDuration(0);
      return;
    }

    if (videoId) {
      if (currentVideoIdRef.current === videoId) return; // same video, don't reload
      currentVideoIdRef.current = videoId;
      setReady(false);
      setPlaying(false);
      setCurrentTime(0);
      setDuration(0);

      if (playerRef.current) {
        // Player already exists — just load new video
        playerRef.current.loadVideoById(videoId);
        return;
      }

      // First-time init
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
            },
            onStateChange: (e: { data: number }) => {
              setPlaying(e.data === 1);
              if (e.data === 0) playNext(); // ended → auto-advance
            },
          },
        });
      });
      return () => { destroyed = true; };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.sourceUrl, track?.source]);

  // Bandcamp: resolve a streamable mp3 from the source page; the <audio>
  // element below drives playback, time, seek, and volume.
  useEffect(() => {
    if (track?.source !== "bandcamp" || !track.sourceUrl) {
      setBcAudioUrl(null);
      return;
    }
    let cancelled = false;
    setBcAudioUrl(null);
    setCurrentTime(0);
    setDuration(0);
    fetch(`/api/bandcamp-audio?url=${encodeURIComponent(track.sourceUrl)}`)
      .then(async (r) => {
        if (!r.ok) {
          console.error("[Bandcamp] /api/bandcamp-audio failed:", r.status, await r.text().catch(() => ""));
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (!data?.audioUrl) {
          console.error("[Bandcamp] no audioUrl in response:", data);
          return;
        }
        setBcAudioUrl(data.audioUrl as string);
        if (typeof data.duration === "number") setDuration(data.duration);
      })
      .catch((err) => console.error("[Bandcamp] audio fetch error:", err));
    return () => {
      cancelled = true;
    };
  }, [track?.source, track?.sourceUrl]);

  // When YT player already exists and track changes, handle ready state for loadVideoById
  useEffect(() => {
    if (!videoId || !playerRef.current) return;
    // loadVideoById triggers onStateChange, so just mark not-ready until first play
    const checkReady = setInterval(() => {
      try {
        const dur = playerRef.current?.getDuration() ?? 0;
        if (dur > 0) {
          setReady(true);
          setDuration(dur);
          clearInterval(checkReady);
        }
      } catch { clearInterval(checkReady); }
    }, 200);
    return () => clearInterval(checkReady);
  }, [videoId]);

  // Poll progress while playing — YouTube only. Bandcamp drives `currentTime`
  // through the <audio> element's `onTimeUpdate`; polling here would stomp it
  // with stale (or zero) values from the YT player ref.
  useEffect(() => {
    if (!playing || track?.source !== "youtube_music") return;
    const id = setInterval(() => {
      const ct = playerRef.current?.getCurrentTime() ?? 0;
      const dur = playerRef.current?.getDuration() ?? 0;
      setCurrentTime(ct);
      if (dur > 0) setDuration(dur);
    }, 500);
    return () => clearInterval(id);
  }, [playing, track?.source]);

  const toggle = () => {
    if (!playerRef.current) return;
    playing ? playerRef.current.pauseVideo() : playerRef.current.playVideo();
  };

  const seek = (pct: number) => {
    if (duration <= 0) return;
    const t = pct * duration;
    if (track?.source === "youtube_music") {
      if (!playerRef.current) return;
      playerRef.current.seekTo(t, true);
      setCurrentTime(t);
    } else if (track?.source === "bandcamp") {
      if (!bcAudioRef.current) return;
      bcAudioRef.current.currentTime = t;
      setCurrentTime(t);
    }
  };

  const handleBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(pct);
  };

  const hasPrev = playingIndex !== null && playingIndex > 0;
  const hasNext = playingIndex !== null && playingIndex < playlist.length - 1;
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const coverUrl =
    track?.coverUrl ??
    (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null);

  if (!track) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-900 border-t border-zinc-800 shadow-2xl">
      {/* Hidden YT iframe holder */}
      <div
        ref={holderRef}
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0, pointerEvents: "none" }}
      />

      {/* Hidden Bandcamp audio — direct mp3 stream extracted from the source page. */}
      {track.source === "bandcamp" && bcAudioUrl && (
        <audio
          ref={bcAudioRef}
          src={bcAudioUrl}
          autoPlay
          onLoadedMetadata={(e) => {
            const a = e.currentTarget;
            if (a.duration && isFinite(a.duration)) setDuration(a.duration);
            a.volume = volume / 100;
          }}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => playNext()}
          onError={(e) => {
            const err = e.currentTarget.error;
            console.error("[Bandcamp] <audio> error:", err?.code, err?.message, "src=", e.currentTarget.src);
          }}
        />
      )}

      <div className="max-w-6xl mx-auto px-4 py-2 flex flex-col gap-1.5">
        {/* Main row */}
        <div className="flex items-center gap-3">
          {/* Cover thumbnail */}
          {coverUrl && (
            <img
              src={coverUrl}
              alt=""
              className="w-10 h-10 rounded object-cover shrink-0"
            />
          )}

          {/* Track info */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-zinc-100 truncate">{track.title}</p>
            <p className="text-xs text-zinc-500 truncate">
              {track.artist}
              <span className="ml-2 text-zinc-700">{SOURCE_LABELS[track.source] ?? track.source}</span>
            </p>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => playPrev()}
              disabled={!hasPrev}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-30"
              aria-label="Previous"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
              </svg>
            </button>

            {(track.source === "youtube_music" || track.source === "bandcamp") && (() => {
              const isBc = track.source === "bandcamp";
              const isReady = isBc ? !!bcAudioUrl : ready;
              const onClick = isBc ? bcToggle : toggle;
              return (
                <button
                  onClick={onClick}
                  disabled={!isReady}
                  className="w-9 h-9 flex items-center justify-center rounded-full bg-zinc-700 hover:bg-zinc-600 text-zinc-100 transition-colors disabled:opacity-40"
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
              );
            })()}

            <button
              onClick={() => playNext()}
              disabled={!hasNext}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-30"
              aria-label="Next"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 18l8.5-6L6 6v12zm2-8.14 5.51 3.86L8 17.14V9.86z" />
                <path d="M16 6h2v12h-2z" />
              </svg>
            </button>

            {/* Volume (YouTube + Bandcamp) */}
            {(track.source === "youtube_music" || track.source === "bandcamp") && (
              <div className="flex items-center gap-1.5 ml-1">
                <button
                  onClick={() => changeVolume(volume === 0 ? 100 : 0)}
                  className="w-7 h-7 flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
                  aria-label={volume === 0 ? "Unmute" : "Mute"}
                >
                  {volume === 0 ? (
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M16.5 12A4.5 4.5 0 0014 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06A8.99 8.99 0 0017.73 18l2 2L21 18.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
                    </svg>
                  ) : volume < 50 ? (
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M18.5 12A4.5 4.5 0 0016 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/>
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                    </svg>
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={volume}
                  onChange={(e) => changeVolume(Number(e.target.value))}
                  aria-label="Volume"
                  className="w-20 h-1 accent-zinc-400 cursor-pointer"
                />
              </div>
            )}

            {/* Open source */}
            <a
              href={track.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
              aria-label="Open on source"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>

            {/* Close */}
            <button
              onClick={close}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800 transition-colors"
              aria-label="Close player"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Progress bar (YouTube + Bandcamp) */}
        {(track.source === "youtube_music" || track.source === "bandcamp") && (
          <div className="flex items-center gap-2 pb-0.5">
            <span className="text-[10px] text-zinc-600 tabular-nums w-7 text-right shrink-0">
              {formatTime(currentTime)}
            </span>
            <div
              role="slider"
              aria-label="Seek"
              aria-valuenow={Math.round(currentTime)}
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              className="flex-1 h-1.5 bg-zinc-800 rounded-full cursor-pointer group/bar"
              onClick={handleBarClick}
            >
              <div
                className="h-full bg-zinc-500 group-hover/bar:bg-zinc-300 rounded-full transition-colors relative"
                style={{ width: `${progressPct}%` }}
              >
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-zinc-100 rounded-full opacity-0 group-hover/bar:opacity-100 transition-opacity" />
              </div>
            </div>
            <span className="text-[10px] text-zinc-600 tabular-nums w-7 shrink-0">
              {formatTime(duration)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
