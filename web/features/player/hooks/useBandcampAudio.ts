"use client";

import { useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import type { SyntheticEvent } from "react";
import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/hono/client";
import type { TrackSource } from "@/features/player/types";

interface BandcampAudioData {
  audioUrl: string;
  duration?: number;
}

interface BandcampProps {
  source: TrackSource | null;
  sourceUrl: string | null;
  volume: number;
  onEnded: () => void;
}

export function useBandcampAudio({ source, sourceUrl, volume, onEnded }: BandcampProps) {
  const audioRef = useRef<HTMLAudioElement>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const { data } = useQuery<BandcampAudioData>({
    queryKey: ["bandcamp-audio", sourceUrl],
    queryFn: async ({ signal }) =>
      parseResponse(api["bandcamp-audio"].$get({ query: { url: sourceUrl! } }, { init: { signal } })),
    enabled: source === "bandcamp" && !!sourceUrl,
  });

  const audioUrl = data?.audioUrl ?? null;

  // Sync volume to the audio element whenever it changes.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 100;
  }, [volume]);

  // Reset playback position whenever the track changes.
  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
  }, [sourceUrl]);

  // Sync duration hint from the API response; onLoadedMetadata will override
  // with the authoritative value once the audio element has parsed the stream.
  useEffect(() => {
    if (typeof data?.duration === "number") {
      setDuration(data.duration);
    }
  }, [data?.duration]);

  const audioEventHandlers = {
    onLoadedMetadata: (e: SyntheticEvent<HTMLAudioElement>) => {
      const a = e.currentTarget;
      if (a.duration && isFinite(a.duration)) setDuration(a.duration);
      a.volume = volume / 100;
    },
    onTimeUpdate: (e: SyntheticEvent<HTMLAudioElement>) => setCurrentTime(e.currentTarget.currentTime),
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => onEnded(),
    onError: (e: SyntheticEvent<HTMLAudioElement>) => {
      const err = e.currentTarget.error;
      console.error("[Bandcamp] <audio> error:", err?.code, err?.message, "src=", e.currentTarget.src);
    },
  };

  return {
    audioRef,
    audioUrl,
    audioEventHandlers,
    playing,
    currentTime,
    duration,
    toggle: () => {
      const a = audioRef.current;
      if (!a) return;
      if (a.paused) a.play().catch((err) => console.error("[Bandcamp] play() rejected:", err));
      else a.pause();
    },
    seekTo: (t: number) => {
      if (!audioRef.current) return;
      audioRef.current.currentTime = t;
      setCurrentTime(t);
    },
  };
}
