"use client";

import { useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { useEffect, useState } from "react";
import { useBandcampAudio } from "./useBandcampAudio";
import { useYTPlayer } from "./useYTPlayer";

import { PLAYABLE_SOURCES } from "@/features/player/constants";
import type { PlayerAdapter, PlayerTrack } from "@/features/player/types";
import { api } from "@/lib/hono/client";

interface Props {
  track: PlayerTrack | null;
  onEnded: () => void;
  swapTrack: (resolved: Partial<PlayerTrack>) => void;
}

interface EmbedData {
  embedUrl: string | null;
  source: string | null;
  sourceUrl: string | null;
  coverUrl: string | null;
}

// Discriminated union: narrowing on `source` gives access to source-specific
// DOM attachment fields. Add a new variant here when wiring up a new adapter.
export type YTPlayerReturn = PlayerAdapter &
  Pick<ReturnType<typeof useYTPlayer>, "videoId"> & {
    source: "youtube_music";
    volume: number;
    setVolume: (v: number) => void;
  };
export type BCPlayerReturn = PlayerAdapter &
  Pick<ReturnType<typeof useBandcampAudio>, "audioRef" | "audioUrl" | "audioEventHandlers"> & {
    source: "bandcamp";
    volume: number;
    setVolume: (v: number) => void;
  };
export type IdlePlayerReturn = PlayerAdapter & {
  source: null;
  volume: number;
  setVolume: (v: number) => void;
};

export type AudioPlayerReturn = YTPlayerReturn | BCPlayerReturn | IdlePlayerReturn;

export function useAudioPlayer({ track, onEnded, swapTrack }: Props): AudioPlayerReturn {
  const [volume, setVolume] = useState(100);

  const yt = useYTPlayer({
    source: track?.source ?? null,
    sourceUrl: track?.sourceUrl ?? null,
    embedUrl: track?.embedUrl ?? null,
    volume,
    onEnded,
  });

  const bc = useBandcampAudio({
    source: track?.source ?? null,
    sourceUrl: track?.sourceUrl ?? null,
    volume,
    onEnded,
  });

  // Resolve non-playable sources (lastfm, cosine_club, etc.) to a YTM/Bandcamp embed.
  const shouldResolve = !!track && !PLAYABLE_SOURCES.has(track.source) && track.source !== "unavailable";

  const { data: embedData, status: embedStatus } = useQuery<EmbedData | null>({
    queryKey: ["embed", track?.title, track?.artist],
    queryFn: async ({ signal }) =>
      parseResponse(api.embed.$get({ query: { title: track!.title, artist: track!.artist } }, { init: { signal } })),
    enabled: shouldResolve,
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    if (!shouldResolve || embedStatus === "pending") return;
    if (embedData?.embedUrl && embedData.source) {
      // Keep the cover the user already sees — the YTM/Bandcamp resolver's
      // thumbnail is often a channel avatar or low-res alternate. Fall back
      // to the resolved cover only when the original is missing.
      swapTrack({
        source: embedData.source,
        embedUrl: embedData.embedUrl,
        sourceUrl: embedData.sourceUrl ?? track!.sourceUrl,
        coverUrl: track!.coverUrl ?? embedData.coverUrl,
      });
    } else {
      swapTrack({ source: "unavailable", embedUrl: null });
    }
    // swapTrack is stable (useCallback). track.sourceUrl/coverUrl are structural
    // values captured when the query result arrived for this track's title/artist key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldResolve, embedStatus, embedData]);

  if (track?.source === "youtube_music") {
    return {
      source: "youtube_music",
      videoId: yt.videoId,
      playing: yt.playing,
      currentTime: yt.currentTime,
      duration: yt.duration,
      isReady: yt.duration > 0,
      toggle: yt.toggle,
      seekTo: yt.seekTo,
      volume,
      setVolume,
    };
  }

  if (track?.source === "bandcamp") {
    return {
      source: "bandcamp",
      audioRef: bc.audioRef,
      audioUrl: bc.audioUrl,
      audioEventHandlers: bc.audioEventHandlers,
      playing: bc.playing,
      currentTime: bc.currentTime,
      duration: bc.duration,
      isReady: !!bc.audioUrl,
      toggle: bc.toggle,
      seekTo: bc.seekTo,
      volume,
      setVolume,
    };
  }

  return {
    source: null,
    playing: false,
    currentTime: 0,
    duration: 0,
    isReady: false,
    toggle: () => {},
    seekTo: () => {},
    volume,
    setVolume,
  };
}
