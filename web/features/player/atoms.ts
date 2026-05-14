import { atom } from "jotai";

import type { PlayerTrack } from "@/features/player/types";

export interface PlayerState {
  playlist: PlayerTrack[];
  playingIndex: number | null;
}

export const playerAtom = atom<PlayerState>({
  playlist: [],
  playingIndex: null,
});

// Track IDs whose embed resolution returned null — skipped by playNext/playPrev
// so onEnded transitions and manual next-clicks never land on an unplayable track.
export const unplayableTrackIdsAtom = atom<Set<string>>(new Set<string>());
