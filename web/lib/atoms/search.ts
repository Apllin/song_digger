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
}

export type SearchStatus = "idle" | "running" | "done" | "error";

interface SearchState {
  query: string;
  tracks: Track[];
  status: SearchStatus;
  errorMsg: string;
  displayCount: number;
}

export const searchAtom = atom<SearchState>({
  query: "",
  tracks: [],
  status: "idle",
  errorMsg: "",
  displayCount: 10,
});
