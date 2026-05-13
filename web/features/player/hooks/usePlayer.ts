"use client";

import { useAtom } from "jotai";
import { useCallback } from "react";

import { playerAtom } from "@/features/player/atoms";
import type { PlayerTrack } from "@/features/player/types";

export function usePlayer() {
  const [state, setState] = useAtom(playerAtom);
  const track = state.playingIndex !== null ? (state.playlist[state.playingIndex] ?? null) : null;

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

  const playNext = useCallback(
    () =>
      setState((prev) => {
        if (prev.playingIndex === null || prev.playlist.length === 0) return prev;
        const next = prev.playingIndex + 1;
        if (next >= prev.playlist.length) return prev;
        return { ...prev, playingIndex: next };
      }),
    [setState],
  );

  const playPrev = useCallback(
    () =>
      setState((prev) => {
        if (prev.playingIndex === null || prev.playlist.length === 0) return prev;
        const prevIdx = prev.playingIndex - 1;
        if (prevIdx < 0) return prev;
        return { ...prev, playingIndex: prevIdx };
      }),
    [setState],
  );

  return {
    ...state,
    track,
    play,
    close,
    swapTrack,
    playNext,
    playPrev,
  };
}
