import { atom } from "jotai";

import type { PlayerTrack, PlaylistExtender } from "@/features/player/types";

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

// Optional loader registered by the playlist owner (e.g. search pagination).
// When playNext walks off the end of the current playlist, it asks the
// extender for more tracks instead of stalling on hasNext=false.
export const playlistExtenderAtom = atom<PlaylistExtender | null>(null);
