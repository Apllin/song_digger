"use client";

import { atom } from "jotai";
import { type Filters, DEFAULT_FILTERS } from "@/components/FilterPanel";

export interface Track {
  id: string;
  title: string;
  artist: string;
  source: string;
  sourceUrl: string;
  coverUrl?: string | null;
  embedUrl?: string | null;
  bpm?: number | null;
  key?: string | null;
  energy?: number | null;
  genre?: string | null;
  label?: string | null;
  score?: number | null;
}

export type SearchStatus = "idle" | "running" | "done" | "error";

interface SearchState {
  query: string;
  filters: Filters;
  tracks: Track[];
  status: SearchStatus;
  errorMsg: string;
  displayCount: number;
  sourceBpm: number | null;
  sourceKey: string | null;
}

export const searchAtom = atom<SearchState>({
  query: "",
  filters: DEFAULT_FILTERS,
  tracks: [],
  status: "idle",
  errorMsg: "",
  displayCount: 10,
  sourceBpm: null,
  sourceKey: null,
});
