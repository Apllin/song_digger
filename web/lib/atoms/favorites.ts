"use client";

import { atom } from "jotai";

interface FavoritesState {
  ids: Set<string>;
  // Composite "artistKey|titleKey" identity keys for disliked tracks.
  // Same normalization as web/lib/aggregator.ts:normalizeArtist /
  // normalizeTitle so the key matches whether built from a Track row
  // or from a /api/dislikes response.
  dislikedKeys: Set<string>;
}

export const favoritesAtom = atom<FavoritesState>({
  ids: new Set<string>(),
  dislikedKeys: new Set<string>(),
});
