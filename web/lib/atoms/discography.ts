"use client";

import { atom } from "jotai";

export interface Artist {
  id: number;
  name: string;
  imageUrl?: string;
}

export interface Release {
  id: number;
  title: string;
  year?: number;
  type: string;
  role: string;
  format?: string;
  label?: string;
  thumb?: string;
}

interface DiscographyState {
  query: string;
  artistSuggestions: Artist[];
  showSuggestions: boolean;
  showHistory: boolean;
  activeIndex: number;
  selectedArtist: Artist | null;
  releases: Release[];
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
  roleFilter: "all",
});
