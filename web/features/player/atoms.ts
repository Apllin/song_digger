import { atom } from "jotai";

import type { PlayerTrack, PlaylistEndHandler } from "@/features/player/types";

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

// Registered by the playlist owner (e.g. search, discography). When playNext
// reaches the end of the current playlist, it calls onEnd and passes
// appendAndAdvance so the owner can fetch and inject the next batch.
export const onPlaylistEndAtom = atom<PlaylistEndHandler | null>(null);
