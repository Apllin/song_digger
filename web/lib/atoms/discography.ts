"use client";

import { atom } from "jotai";

import type { DiscogsArtist } from "@/lib/python-api/generated/types/DiscogsArtist";

interface DiscographyState {
  query: string;
  artistSuggestions: DiscogsArtist[];
  showSuggestions: boolean;
  showHistory: boolean;
  activeIndex: number;
  selectedArtist: DiscogsArtist | null;
  page: number;
  loadingArtists: boolean;
  roleFilter: "all" | "main";
}

export const discographyAtom = atom<DiscographyState>({
  query: "",
  artistSuggestions: [],
  showSuggestions: false,
  showHistory: false,
  activeIndex: -1,
  selectedArtist: null,
  page: 1,
  loadingArtists: false,
  roleFilter: "main",
});
