"use client";

import { atom } from "jotai";

interface FavoritesState {
  ids: Set<string>;
  dislikedUrls: Set<string>;
}

export const favoritesAtom = atom<FavoritesState>({
  ids: new Set<string>(),
  dislikedUrls: new Set<string>(),
});
