"use client";

import { atom } from "jotai";

export interface Track {
  id: string;
  title: string;
  artist: string;
  source: string;
  sourceUrl: string;
  coverUrl?: string | null;
  embedUrl?: string | null;
  score?: number | null;
  sources?: string[] | null;
}

interface SearchState {
  query: string;
  tracks: Track[];
  displayCount: number;
}

export const searchAtom = atom<SearchState>({
  query: "",
  tracks: [],
  displayCount: 18,
});
