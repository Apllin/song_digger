"use client";

import { atom } from "jotai";

import type { ReleaseRoleFilter } from "@/features/discography/schemas";
import type { DiscogsArtist } from "@/lib/python-api/generated/types/DiscogsArtist";

interface DiscographyState {
  page: number;
  roleFilter: ReleaseRoleFilter;
  query: string;
  selectedItem: DiscogsArtist | null;
}

export const discographyAtom = atom<DiscographyState>({
  page: 1,
  roleFilter: "Main",
  query: "",
  selectedItem: null,
});
