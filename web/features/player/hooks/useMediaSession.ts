"use client";

import { useEffect } from "react";

import type { PlayerTrack } from "@/features/player/types";

interface MediaSessionProps {
  track: PlayerTrack | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  hasNext: boolean;
  hasPrev: boolean;
  toggle: () => void;
  playNext: () => void;
  playPrev: () => void;
  seekTo: (t: number) => void;
}

export function useMediaSession({
  track,
  playing,
  currentTime,
  duration,
  hasNext,
  hasPrev,
  toggle,
  playNext,
  playPrev,
  seekTo,
}: MediaSessionProps) {
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

    // The effect re-registers on `playing` changes, so gating toggle() on the
    // current state turns it into a true play/pause for every adapter.
    navigator.mediaSession.setActionHandler("play", () => {
      if (!playing) toggle();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      if (playing) toggle();
    });
    // null hides the button in OS controls when the action is unavailable.
    navigator.mediaSession.setActionHandler("nexttrack", hasNext ? () => playNext() : null);
    navigator.mediaSession.setActionHandler("previoustrack", hasPrev ? () => playPrev() : null);
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (details.seekTime !== undefined) seekTo(details.seekTime);
    });

    return () => {
      try {
        navigator.mediaSession.setActionHandler("play", null);
        navigator.mediaSession.setActionHandler("pause", null);
        navigator.mediaSession.setActionHandler("nexttrack", null);
        navigator.mediaSession.setActionHandler("previoustrack", null);
        navigator.mediaSession.setActionHandler("seekto", null);
      } catch {
        // Ignore if Media Session API is unavailable
      }
    };
  }, [track, playing, hasNext, hasPrev, toggle, playNext, playPrev, seekTo]);

  // Keep OS scrubber position in sync (iOS uses this for the lockscreen slider).
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
}
