"use client";

import { atom } from "jotai";

interface DiscographyState {
  page: number;
  roleFilter: "all" | "main";
}

export const discographyAtom = atom<DiscographyState>({
  page: 1,
  roleFilter: "main",
});
