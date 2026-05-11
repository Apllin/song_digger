"use client";

import { atom } from "jotai";

import type { DiscogsArtist } from "@/lib/python-api/generated/types/DiscogsArtist";

interface DiscographyState {
  query: string;
  showSuggestions: boolean;
  showHistory: boolean;
  selectedArtist: DiscogsArtist | null;
  page: number;
  roleFilter: "all" | "main";
}

export const discographyAtom = atom<DiscographyState>({
  query: "",
  showSuggestions: false,
  showHistory: false,
  selectedArtist: null,
  page: 1,
  roleFilter: "main",
});
