"use client";

import { useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { useAtom, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";
import { useBandcampAudio } from "./useBandcampAudio";
import { useSoundCloudPlayer } from "./useSoundCloudPlayer";
import { useYTPlayer } from "./useYTPlayer";

import { playerVolumeAtom, unplayableTrackIdsAtom } from "@/features/player/atoms";
import type { PlayerAdapter, PlayerTrack, TrackSource } from "@/features/player/types";
import { extractVideoId } from "@/features/player/ytApi";
import { api } from "@/lib/hono/client";

interface Props {
  track: PlayerTrack | null;
  onEnded: () => void;
  swapTrack: (resolved: Partial<PlayerTrack>) => void;
}

interface EmbedData {
  embedUrl: string | null;
  source: TrackSource | null;
  sourceUrl: string | null;
  coverUrl: string | null;
}

// Discriminated union: narrowing on `source` gives access to source-specific
// DOM attachment fields. Add a new variant here when wiring up a new adapter.
interface AdapterShared {
  volume: number;
  setVolume: (v: number) => void;
  resolving: boolean;
}
export type YTPlayerReturn = PlayerAdapter &
  Pick<ReturnType<typeof useYTPlayer>, "videoId"> &
  AdapterShared & { source: "youtube_music" };
export type BCPlayerReturn = PlayerAdapter &
  Pick<ReturnType<typeof useBandcampAudio>, "audioRef" | "audioUrl" | "audioEventHandlers"> &
  AdapterShared & { source: "bandcamp" };
export type SCPlayerReturn = PlayerAdapter &
  Pick<ReturnType<typeof useSoundCloudPlayer>, "iframeRef" | "embedUrl"> &
  AdapterShared & { source: "soundcloud" };
export type IdlePlayerReturn = PlayerAdapter & AdapterShared & { source: null };

export type AudioPlayerReturn = YTPlayerReturn | BCPlayerReturn | SCPlayerReturn | IdlePlayerReturn;

// A "playable" source row is only actually playable if the adapter has what it
// needs. Track rows from older saves or feeds (discography/label tracklists)
// can miss these fields, and without this guard the adapter spins forever.
function canAdapterPlay(track: PlayerTrack): boolean {
  switch (track.source) {
    case "youtube_music":
      return !!extractVideoId("youtube_music", track.sourceUrl, track.embedUrl);
    case "bandcamp":
      return !!track.sourceUrl;
    case "soundcloud":
      return !!track.embedUrl;
    default:
      return false;
  }
}

export function useAudioPlayer({ track, onEnded, swapTrack }: Props): AudioPlayerReturn {
  const [volume, setVolume] = useAtom(playerVolumeAtom);
  const setUnplayable = useSetAtom(unplayableTrackIdsAtom);

  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

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

  const sc = useSoundCloudPlayer({
    source: track?.source ?? null,
    embedUrl: track?.embedUrl ?? null,
    volume,
    onEnded,
  });

  // Resolve via /api/embed whenever the current track can't be played as-is:
  // - source is null (discography/label tracks, or a failed previous resolve)
  // - source is non-playable (lastfm, cosine_club, yandex, trackidnet)
  // - source is "playable" but the data the adapter needs is missing
  //   (e.g. a YTM row without a videoId, a SC row without embedUrl).
  // Empty title/artist would produce a useless lookup, so guard on those too.
  const shouldResolve = !!track && !!track.title && !!track.artist && !canAdapterPlay(track);

  const {
    data: embedData,
    status: embedStatus,
    fetchStatus: embedFetchStatus,
  } = useQuery<EmbedData | null>({
    queryKey: ["embed", track?.title, track?.artist],
    queryFn: async ({ signal }) => {
      const raw = await parseResponse(
        api.embed.$get({ query: { title: track!.title, artist: track!.artist } }, { init: { signal } }),
      );
      if (!raw) return null;
      return { ...raw, source: raw.source as TrackSource | null };
    },
    enabled: shouldResolve,
    staleTime: Infinity,
    retry: 1,
  });

  const resolving = shouldResolve && embedFetchStatus === "fetching";

  useEffect(() => {
    if (!shouldResolve || embedStatus === "pending" || embedStatus === "error") return;
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
      // Mark the active track unplayable and skip forward. playNext (via onEnded)
      // walks past unplayable IDs, so we land on the next playable track without
      // the user ever seeing "No playback available".
      const trackId = track?.id;
      if (trackId) {
        setUnplayable((prev) => {
          if (prev.has(trackId)) return prev;
          const next = new Set(prev);
          next.add(trackId);
          return next;
        });
      }
      swapTrack({ source: null, embedUrl: null });
      onEndedRef.current();
    }
    // swapTrack is stable (useCallback). track.sourceUrl/coverUrl are structural
    // values captured when the query result arrived for this track's title/artist key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldResolve, embedStatus, embedData]);

  const idle: IdlePlayerReturn = {
    source: null,
    playing: false,
    currentTime: 0,
    duration: 0,
    isReady: false,
    toggle: () => {},
    seekTo: () => {},
    volume,
    setVolume,
    resolving,
  };

  // While we're resolving a playable embed, show the idle UI ("Finding playable
  // source…") instead of an adapter UI that can't actually play. Once swapTrack
  // updates the source, the matching branch below renders the real player.
  if (shouldResolve) return idle;

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
      resolving,
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
      resolving,
    };
  }

  if (track?.source === "soundcloud") {
    return {
      source: "soundcloud",
      iframeRef: sc.iframeRef,
      embedUrl: sc.embedUrl,
      playing: sc.playing,
      currentTime: sc.currentTime,
      duration: sc.duration,
      isReady: sc.isReady,
      toggle: sc.toggle,
      seekTo: sc.seekTo,
      volume,
      setVolume,
      resolving,
    };
  }

  return idle;
}
