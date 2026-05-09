"use client";

import { atom } from "jotai";

import type { DiscogsLabel } from "@/lib/python-api/generated/types/DiscogsLabel";

interface LabelsState {
  query: string;
  suggestions: DiscogsLabel[];
  showSuggestions: boolean;
  showHistory: boolean;
  activeIndex: number;
  selectedLabel: DiscogsLabel | null;
  page: number;
  loadingLabels: boolean;
}

export const labelsAtom = atom<LabelsState>({
  query: "",
  suggestions: [],
  showSuggestions: false,
  showHistory: false,
  activeIndex: -1,
  selectedLabel: null,
  page: 1,
  loadingLabels: false,
});
