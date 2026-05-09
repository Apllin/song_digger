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
    // Mutate the active track in place — used by BottomPlayer to swap in a
    // resolved YTM/Bandcamp embed for tracks whose original source isn't
    // playable (trackid, lastfm, cosine_club). Mirrors the change in the
    // playlist slot so subsequent prev/next navigation sees the resolved
    // version, not the unresolved one.
    swapTrack: (resolved: Partial<PlayerTrack>) =>
      setState((prev) => {
        if (!prev.track || prev.playingIndex === null) return prev;
        const merged = { ...prev.track, ...resolved };
        const playlist = prev.playlist.map((t, i) => (i === prev.playingIndex ? { ...t, ...resolved } : t));
        return { ...prev, track: merged, playlist };
      }),
    playNext: () =>
      setState((prev) => {
        if (prev.playingIndex === null || prev.playlist.length === 0) return prev;
        const next = prev.playingIndex + 1;
        if (next >= prev.playlist.length) return prev;
        return { ...prev, track: prev.playlist[next] ?? null, playingIndex: next };
      }),
    playPrev: () =>
      setState((prev) => {
        if (prev.playingIndex === null || prev.playlist.length === 0) return prev;
        const prevIdx = prev.playingIndex - 1;
        if (prevIdx < 0) return prev;
        return { ...prev, track: prev.playlist[prevIdx] ?? null, playingIndex: prevIdx };
      }),
  };
}
