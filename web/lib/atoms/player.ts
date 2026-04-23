"use client";

import { atom, useAtom } from "jotai";

export interface PlayerTrack {
  id: string;
  title: string;
  artist: string;
  source: string;
  sourceUrl: string;
  coverUrl?: string | null;
  embedUrl?: string | null;
}

interface PlayerState {
  track: PlayerTrack | null;
  playlist: PlayerTrack[];
  playingIndex: number | null;
}

export const playerAtom = atom<PlayerState>({
  track: null,
  playlist: [],
  playingIndex: null,
});

export function usePlayer() {
  const [state, setState] = useAtom(playerAtom);

  return {
    ...state,
    play: (track: PlayerTrack, playlist: PlayerTrack[], index: number) =>
      setState({ track, playlist, playingIndex: index }),
    close: () => setState({ track: null, playlist: [], playingIndex: null }),
    playNext: () =>
      setState((prev) => {
        if (prev.playingIndex === null || prev.playlist.length === 0) return prev;
        const next = prev.playingIndex + 1;
        if (next >= prev.playlist.length) return prev;
        return { ...prev, track: prev.playlist[next], playingIndex: next };
      }),
    playPrev: () =>
      setState((prev) => {
        if (prev.playingIndex === null || prev.playlist.length === 0) return prev;
        const prevIdx = prev.playingIndex - 1;
        if (prevIdx < 0) return prev;
        return { ...prev, track: prev.playlist[prevIdx], playingIndex: prevIdx };
      }),
  };
}
