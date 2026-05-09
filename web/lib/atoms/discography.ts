"use client";

import { atom } from "jotai";

import type { ArtistRelease } from "@/lib/python-api/generated/types/ArtistRelease";
import type { DiscogsArtist } from "@/lib/python-api/generated/types/DiscogsArtist";

interface DiscographyState {
  query: string;
  artistSuggestions: DiscogsArtist[];
  showSuggestions: boolean;
  showHistory: boolean;
  activeIndex: number;
  selectedArtist: DiscogsArtist | null;
  releases: ArtistRelease[];
  page: number;
  loadingArtists: boolean;
  loadingReleases: boolean;
  roleFilter: "all" | "main";
}

export const discographyAtom = atom<DiscographyState>({
  query: "",
  artistSuggestions: [],
  showSuggestions: false,
  showHistory: false,
  activeIndex: -1,
  selectedArtist: null,
  releases: [],
  page: 1,
  loadingArtists: false,
  loadingReleases: false,
  roleFilter: "main",
});
