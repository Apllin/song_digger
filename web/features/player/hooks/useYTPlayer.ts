"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { TrackSource } from "@/features/player/types";
import { ensureYTSingleton, extractVideoId, getYTSingleton, registerYTHandlers } from "@/features/player/ytApi";

interface YTPlayerProps {
  source: TrackSource | null;
  sourceUrl: string | null;
  embedUrl: string | null;
  volume: number;
  onEnded: () => void;
}

export function useYTPlayer({ source, sourceUrl, embedUrl, volume, onEnded }: YTPlayerProps) {
  const videoId = extractVideoId(source, sourceUrl, embedUrl);
  const currentVideoIdRef = useRef<string | null>(null);
  const onEndedRef = useRef(onEnded);
  const volumeRef = useRef(volume);

  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Register handlers once on mount. onEndedRef/volumeRef ensure the singleton
  // always sees the latest values without re-registration on every render.
  useEffect(() => {
    registerYTHandlers({
      onStateChange: (data) => setPlaying(data === 1),
      onEnded: () => onEndedRef.current(),
      onReady: (dur) => {
        if (dur > 0) setDuration(dur);
        // Apply current volume when the player first becomes ready.
        getYTSingleton()?.setVolume(volumeRef.current);
      },
    });
  }, []);

  // The YT singleton lives in document.body outside React's tree, so it
  // keeps playing after BottomPlayer unmounts on close(). Pause on teardown.
  useEffect(() => {
    return () => {
      try {
        getYTSingleton()?.pauseVideo();
      } catch {
        // singleton may not yet exist
      }
    };
  }, []);

  useEffect(() => {
    if (source !== "youtube_music") {
      try {
        getYTSingleton()?.pauseVideo();
      } catch {
        // safe to ignore if player is not yet initialised
      }
      setPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      return;
    }

    if (!videoId) return;
    if (currentVideoIdRef.current === videoId) return;
    currentVideoIdRef.current = videoId;
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    const existing = getYTSingleton();
    if (existing) {
      existing.loadVideoById(videoId);
    } else {
      ensureYTSingleton(videoId); // creates with this videoId; auto-plays on ready
    }
  }, [videoId, source]);

  // Sync volume to the YT singleton whenever it changes.
  useEffect(() => {
    getYTSingleton()?.setVolume(volume);
  }, [volume]);

  // Poll duration after loadVideoById — onReady does not fire on subsequent loads.
  useEffect(() => {
    if (!videoId || source !== "youtube_music") return;
    const checkReady = setInterval(() => {
      try {
        const dur = getYTSingleton()?.getDuration() ?? 0;
        if (dur > 0) {
          setDuration(dur);
          clearInterval(checkReady);
        }
      } catch {
        clearInterval(checkReady);
      }
    }, 200);
    return () => clearInterval(checkReady);
  }, [videoId, source]);

  // Poll currentTime while playing (BC drives its own via <audio> onTimeUpdate).
  useEffect(() => {
    if (!playing || source !== "youtube_music") return;
    const id = setInterval(() => {
      const ct = getYTSingleton()?.getCurrentTime() ?? 0;
      const dur = getYTSingleton()?.getDuration() ?? 0;
      setCurrentTime(ct);
      if (dur > 0) setDuration(dur);
    }, 500);
    return () => clearInterval(id);
  }, [playing, source]);

  const toggle = useCallback(() => {
    const player = getYTSingleton();
    if (player) {
      // Read ground-truth state from the player to avoid stale closure issues.
      if (player.getPlayerState() === 1) {
        player.pauseVideo();
      } else {
        player.playVideo();
      }
    }
  }, []);

  const seekTo = useCallback((t: number) => {
    getYTSingleton()?.seekTo(t, true);
    setCurrentTime(t);
  }, []);

  return {
    videoId,
    playing,
    currentTime,
    duration,
    toggle,
    seekTo,
  };
}
