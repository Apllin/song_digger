"use client";

import { useAtom, useAtomValue } from "jotai";
import { useCallback, useMemo } from "react";

import { playerAtom, unplayableTrackIdsAtom } from "@/features/player/atoms";
import type { PlayerTrack } from "@/features/player/types";

export function usePlayer() {
  const [state, setState] = useAtom(playerAtom);
  const unplayableIds = useAtomValue(unplayableTrackIdsAtom);
  const track = state.playingIndex !== null ? (state.playlist[state.playingIndex] ?? null) : null;

  const nextPlayableIndex = useMemo(() => {
    if (state.playingIndex === null) return null;
    for (let i = state.playingIndex + 1; i < state.playlist.length; i++) {
      const candidate = state.playlist[i];
      if (candidate && !unplayableIds.has(candidate.id)) return i;
    }
    return null;
  }, [state.playingIndex, state.playlist, unplayableIds]);

  const prevPlayableIndex = useMemo(() => {
    if (state.playingIndex === null) return null;
    for (let i = state.playingIndex - 1; i >= 0; i--) {
      const candidate = state.playlist[i];
      if (candidate && !unplayableIds.has(candidate.id)) return i;
    }
    return null;
  }, [state.playingIndex, state.playlist, unplayableIds]);

  const play = useCallback(
    (_track: PlayerTrack, playlist: PlayerTrack[], index: number) =>
      setState({
        playlist,
        playingIndex: index,
      }),
    [setState],
  );

  const close = useCallback(
    () =>
      setState({
        playlist: [],
        playingIndex: null,
      }),
    [setState],
  );

  // Mutate the active track in place — used by BottomPlayer to swap in a
  // resolved YTM/Bandcamp embed for tracks whose original source isn't
  // playable (trackid, lastfm, cosine_club, yandex). Updating the playlist
  // slot means subsequent prev/next navigation sees the resolved version.
  const swapTrack = useCallback(
    (resolved: Partial<PlayerTrack>) =>
      setState((prev) => {
        if (prev.playingIndex === null) return prev;
        const playlist = prev.playlist.map((t, i) => (i === prev.playingIndex ? { ...t, ...resolved } : t));
        return { ...prev, playlist };
      }),
    [setState],
  );

  const playNext = useCallback(() => {
    if (nextPlayableIndex === null) return;
    setState((prev) => ({ ...prev, playingIndex: nextPlayableIndex }));
  }, [setState, nextPlayableIndex]);

  const playPrev = useCallback(() => {
    if (prevPlayableIndex === null) return;
    setState((prev) => ({ ...prev, playingIndex: prevPlayableIndex }));
  }, [setState, prevPlayableIndex]);

  return {
    ...state,
    track,
    play,
    close,
    swapTrack,
    playNext,
    playPrev,
    hasNext: nextPlayableIndex !== null,
    hasPrev: prevPlayableIndex !== null,
  };
}
