"use client";

import { useAtom, useAtomValue } from "jotai";
import { useCallback, useMemo } from "react";

import { playerAtom, playlistExtenderAtom, unplayableTrackIdsAtom } from "@/features/player/atoms";
import type { PlayerTrack } from "@/features/player/types";

export function usePlayer() {
  const [state, setState] = useAtom(playerAtom);
  const unplayableIds = useAtomValue(unplayableTrackIdsAtom);
  const extender = useAtomValue(playlistExtenderAtom);
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
    if (nextPlayableIndex !== null) {
      setState((prev) => ({ ...prev, playingIndex: nextPlayableIndex }));
      return;
    }
    if (!extender?.hasMore) return;
    // Fire-and-forget: load the next page, append new tracks, jump to the
    // first new index. Concurrent calls dedupe via the existingIds check.
    void extender.loadMore().then((more) => {
      if (more.length === 0) return;
      setState((prev) => {
        const existingIds = new Set(prev.playlist.map((t) => t.id));
        const additions = more.filter((t) => !existingIds.has(t.id));
        if (additions.length === 0) return prev;
        return {
          ...prev,
          playlist: [...prev.playlist, ...additions],
          playingIndex: prev.playlist.length,
        };
      });
    });
  }, [setState, nextPlayableIndex, extender]);

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
    hasNext: nextPlayableIndex !== null || (extender?.hasMore ?? false),
    hasPrev: prevPlayableIndex !== null,
  };
}
