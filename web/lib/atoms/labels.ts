"use client";

import { atom } from "jotai";

import type { DiscogsLabel } from "@/lib/python-api/generated/types/DiscogsLabel";

interface LabelsState {
  query: string;
  showSuggestions: boolean;
  showHistory: boolean;
  activeIndex: number;
  selectedLabel: DiscogsLabel | null;
  page: number;
}

export const labelsAtom = atom<LabelsState>({
  query: "",
  showSuggestions: false,
  showHistory: false,
  activeIndex: -1,
  selectedLabel: null,
  page: 1,
});
