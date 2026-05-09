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
  unavailable: "No playback available",
};

// Sources that the BottomPlayer can drive directly. Anything else is sent to
// /api/embed for YTM/Bandcamp resolution before playback.
const PLAYABLE_SOURCES = new Set(["youtube_music", "bandcamp"]);

// ─── Component ────────────────────────────────────────────────────────────────
export function BottomPlayer() {
  const { track, playingIndex, playlist, close, playNext, playPrev, swapTrack } = usePlayer();
  const [resolving, setResolving] = useState(false);

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
  const [coverFailed, setCoverFailed] = useState(false);

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
      try {
        playerRef.current?.pauseVideo();
      } catch {
        // YT player may throw if already destroyed; safe to ignore
      }
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
      return () => {
        destroyed = true;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.sourceUrl, track?.source]);

  // Reset the cover-error guard when the track changes, otherwise one broken
  // image would suppress every subsequent track's cover.
  useEffect(() => {
    setCoverFailed(false);
  }, [track?.id]);

  // For tracks whose original source isn't directly playable (trackid, lastfm,
  // cosine_club, ...), resolve a YTM exact-match or Bandcamp fallback via
  // /api/embed and swap the active track in place. Cache lives in Postgres
  // (TrackEmbed) so the second click on the same track is just a DB lookup.
  // The "unavailable" sentinel marks tracks the resolver couldn't place on
  // either platform, so this effect doesn't loop.
  useEffect(() => {
    if (!track) return;
    if (PLAYABLE_SOURCES.has(track.source)) return;
    if (track.source === "unavailable") return;

    let cancelled = false;
    setResolving(true);

    const params = new URLSearchParams({ title: track.title, artist: track.artist });
    fetch(`/api/embed?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          data: {
            embedUrl: string | null;
            source: string | null;
            sourceUrl: string | null;
            coverUrl: string | null;
          } | null,
        ) => {
          if (cancelled) return;
          if (data?.embedUrl && data.source) {
            // Keep the cover the user already sees on the TrackCard — the
            // YTM/Bandcamp resolver's thumbnail is often a channel avatar
            // or a low-res alternate that visibly differs from the original
            // artwork. Fall back to the resolved cover only when the
            // original is missing.
            swapTrack({
              source: data.source,
              embedUrl: data.embedUrl,
              sourceUrl: data.sourceUrl ?? track.sourceUrl,
              coverUrl: track.coverUrl ?? data.coverUrl,
            });
          } else {
            swapTrack({ source: "unavailable", embedUrl: null });
          }
        },
      )
      .catch((err) => {
        if (cancelled) return;
        console.error("[/api/embed] resolve failed:", err);
        swapTrack({ source: "unavailable", embedUrl: null });
      })
      .finally(() => {
        if (!cancelled) setResolving(false);
      });

    return () => {
      cancelled = true;
    };
    // swapTrack closes over jotai's setState (stable), so even a stale
    // closure performs the same write — safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, track?.source]);

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
      } catch {
        clearInterval(checkReady);
      }
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
    if (playing) playerRef.current.pauseVideo();
    else playerRef.current.playVideo();
  };

  // Spacebar globally toggles play/pause. Skip when typing into an input,
  // textarea, or contenteditable so the search field still gets spaces.
  useEffect(() => {
    if (!track) return;
    const handler = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || t?.isContentEditable) return;
      e.preventDefault();
      if (track.source === "bandcamp") bcToggle();
      else if (track.source === "youtube_music") toggle();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // bcToggle/toggle close over refs and `playing` — re-bind on those.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.source, playing]);

  // Media Session API — exposes track metadata + play/pause/next/prev to the
  // OS (iOS lockscreen, Android notification, macOS Now Playing). Together
  // with the <audio playsInline> on Bandcamp this lets playback survive a
  // screen lock or app backgrounding on mobile. YouTube iframe is harder to
  // keep alive on iOS lock — but the lockscreen controls still drive our
  // play/pause/skip via the action handlers below.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    if (!track) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      artwork: track.coverUrl
        ? [
            { src: track.coverUrl, sizes: "256x256", type: "image/jpeg" },
            { src: track.coverUrl, sizes: "512x512", type: "image/jpeg" },
          ]
        : [],
    });
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";

    navigator.mediaSession.setActionHandler("play", () => {
      if (track.source === "bandcamp") bcAudioRef.current?.play().catch(() => {});
      else if (track.source === "youtube_music") playerRef.current?.playVideo();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      if (track.source === "bandcamp") bcAudioRef.current?.pause();
      else if (track.source === "youtube_music") playerRef.current?.pauseVideo();
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      if (playingIndex !== null && playingIndex < playlist.length - 1) playNext();
    });
    navigator.mediaSession.setActionHandler("previoustrack", () => {
      if (playingIndex !== null && playingIndex > 0) playPrev();
    });
    return () => {
      try {
        navigator.mediaSession.setActionHandler("play", null);
        navigator.mediaSession.setActionHandler("pause", null);
        navigator.mediaSession.setActionHandler("nexttrack", null);
        navigator.mediaSession.setActionHandler("previoustrack", null);
      } catch {
        // Ignore if Media Session API is unavailable or handlers not set
      }
    };
  }, [track, playing, playingIndex, playlist.length, playNext, playPrev]);

  // Keep position state in sync with the OS (iOS uses this for the scrubber).
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    if (!track || duration <= 0 || !isFinite(duration)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        position: Math.min(currentTime, duration),
        playbackRate: 1,
      });
    } catch {
      // Ignore if setPositionState is unsupported
    }
  }, [track, currentTime, duration]);

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

  const seekFromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(pct);
  };

  const hasPrev = playingIndex !== null && playingIndex > 0;
  const hasNext = playingIndex !== null && playingIndex < playlist.length - 1;
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

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

      <div className="px-4 py-2 flex flex-col gap-1.5">
        {/* Main row */}
        <div className="flex items-center gap-3">
          {/* Cover thumbnail */}
          {coverUrl && !coverFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverUrl}
              alt=""
              className="w-[36px] h-[36px] rounded-lg object-cover shrink-0"
              style={{ border: "1px solid var(--td-hair)" }}
              onError={() => setCoverFailed(true)}
            />
          ) : (
            <div
              className="w-[36px] h-[36px] rounded-lg shrink-0 relative overflow-hidden"
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
            <p className="text-[11px] text-td-fg-m truncate">
              {track.artist}
              <span className="ml-2" style={{ color: "var(--td-fg-m)" }}>
                · {resolving ? "Finding playable source…" : (SOURCE_LABELS[track.source] ?? track.source)}
              </span>
            </p>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => playPrev()}
              disabled={!hasPrev}
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors disabled:opacity-30"
              style={{ color: "var(--td-fg-d)" }}
              aria-label="Previous"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
              </svg>
            </button>

            {(track.source === "youtube_music" || track.source === "bandcamp") &&
              (() => {
                const isBc = track.source === "bandcamp";
                const isReady = isBc ? !!bcAudioUrl : ready;
                const onClick = isBc ? bcToggle : toggle;
                return (
                  <button
                    onClick={onClick}
                    disabled={!isReady}
                    className="w-[34px] h-[34px] flex items-center justify-center rounded-full transition-opacity hover:opacity-90 disabled:opacity-40"
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
                );
              })()}

            <button
              onClick={() => playNext()}
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
            {(track.source === "youtube_music" || track.source === "bandcamp") && (
              <div className="flex items-center gap-1.5 ml-1">
                <button
                  onClick={() => changeVolume(volume === 0 ? 100 : 0)}
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
                  onChange={(e) => changeVolume(Number(e.target.value))}
                  aria-label="Volume"
                  className="w-20 h-1 cursor-pointer"
                  style={{ accentColor: "var(--td-accent)" }}
                />
              </div>
            )}

            {/* Open source */}
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
        {(track.source === "youtube_music" || track.source === "bandcamp") && (
          <div className="flex items-center gap-2 font-mono-td">
            <span className="text-[10px] text-td-fg-m tabular-nums w-8 text-right shrink-0">
              {formatTime(currentTime)}
            </span>
            <div
              role="slider"
              aria-label="Seek"
              aria-valuenow={Math.round(currentTime)}
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              className="flex-1 h-[5px] rounded-full cursor-pointer group/bar touch-none"
              style={{ background: "rgba(255, 255, 255, 0.18)" }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                seekFromPointer(e);
              }}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                  seekFromPointer(e);
                }
              }}
            >
              <div
                className="h-full rounded-full relative"
                style={{
                  width: `${progressPct}%`,
                  background: "var(--td-accent)",
                  boxShadow: "0 0 12px var(--td-accent)",
                }}
              >
                <div
                  className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 w-[13px] h-[13px] rounded-full transition-transform group-hover/bar:scale-110"
                  style={{
                    background: "#ffffff",
                    border: "2px solid var(--td-accent)",
                    boxShadow: "0 0 0 1px rgba(0,0,0,0.3), 0 0 12px var(--td-accent-soft)",
                  }}
                />
              </div>
            </div>
            <span className="text-[10px] text-td-fg-m tabular-nums w-8 shrink-0">{formatTime(duration)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
