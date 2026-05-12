"use client";

import { atom } from "jotai";

interface SearchState {
  query: string;
  // The id of the completed SearchQuery row backing the current results.
  // Pages 2+ are fetched from `/api/search/:id` keyed off this. `null` until
  // the first search returns.
  id: string | null;
  page: number;
}

export const searchAtom = atom<SearchState>({
  query: "",
  id: null,
  page: 1,
});
