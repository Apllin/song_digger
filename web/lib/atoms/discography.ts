"use client";

import { atom } from "jotai";

import type { ReleaseRoleFilter } from "@/features/discography/schemas";

interface DiscographyState {
  page: number;
  roleFilter: ReleaseRoleFilter;
  selectedName: string | null;
}

export const discographyAtom = atom<DiscographyState>({
  page: 1,
  roleFilter: "Main",
  selectedName: null,
});
