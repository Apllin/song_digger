"use client";

import { atom } from "jotai";

import type { ArtistId, ReleaseRoleFilter } from "@/features/discography/schemas";

interface DiscographyState {
  page: number;
  roleFilter: ReleaseRoleFilter;
  query: string;
  selectedArtistId: ArtistId | null;
}

export const discographyAtom = atom<DiscographyState>({
  page: 1,
  roleFilter: "Main",
  query: "",
  selectedArtistId: null,
});
