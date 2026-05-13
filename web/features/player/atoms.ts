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
