"use client";

import { atom } from "jotai";

export interface Label {
  id: number;
  name: string;
  imageUrl?: string;
}

interface LabelsState {
  query: string;
  suggestions: Label[];
  showSuggestions: boolean;
  showHistory: boolean;
  activeIndex: number;
  selectedLabel: Label | null;
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
