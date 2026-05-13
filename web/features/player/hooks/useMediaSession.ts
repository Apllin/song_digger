"use client";

import { type RefObject, useEffect } from "react";

import type { PlayerTrack } from "@/features/player/types";
import { getYTSingleton } from "@/features/player/ytApi";

interface MediaSessionProps {
  track: PlayerTrack | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  playingIndex: number | null;
  playlist: PlayerTrack[];
  playNext: () => void;
  playPrev: () => void;
  seekTo: (t: number) => void;
  audioRef: RefObject<HTMLAudioElement | null> | null;
}

export function useMediaSession({
  track,
  playing,
  currentTime,
  duration,
  playingIndex,
  playlist,
  playNext,
  playPrev,
  seekTo,
  audioRef,
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

    navigator.mediaSession.setActionHandler("play", () => {
      if (track.source === "bandcamp") audioRef?.current?.play().catch(() => {});
      else if (track.source === "youtube_music") getYTSingleton()?.playVideo();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      if (track.source === "bandcamp") audioRef?.current?.pause();
      else if (track.source === "youtube_music") getYTSingleton()?.pauseVideo();
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      if (playingIndex !== null && playingIndex < playlist.length - 1) playNext();
    });
    navigator.mediaSession.setActionHandler("previoustrack", () => {
      if (playingIndex !== null && playingIndex > 0) playPrev();
    });
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
  }, [track, playing, audioRef, playNext, playPrev, seekTo, playingIndex, playlist.length]);

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
