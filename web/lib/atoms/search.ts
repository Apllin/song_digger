"use client";

import { atom } from "jotai";

import type { SearchQueryId } from "@/features/search/schemas";

interface SearchState {
  query: string;

  id: SearchQueryId | null;
  page: number;
}

export const searchAtom = atom<SearchState>({
  query: "",
  id: null,
  page: 1,
});
