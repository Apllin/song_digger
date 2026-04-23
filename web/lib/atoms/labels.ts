"use client";

import { atom } from "jotai";

export interface Label {
  id: number;
  name: string;
  imageUrl?: string;
}

export interface LabelRelease {
  id: number;
  title: string;
  year?: number;
  artist?: string;
  format?: string;
  catno?: string;
  thumb?: string;
  type?: string;
}

interface LabelsState {
  query: string;
  suggestions: Label[];
  showSuggestions: boolean;
  showHistory: boolean;
  activeIndex: number;
  selectedLabel: Label | null;
  releases: LabelRelease[];
  page: number;
  loadingLabels: boolean;
  loadingReleases: boolean;
}

export const labelsAtom = atom<LabelsState>({
  query: "",
  suggestions: [],
  showSuggestions: false,
  showHistory: false,
  activeIndex: -1,
  selectedLabel: null,
  releases: [],
  page: 1,
  loadingLabels: false,
  loadingReleases: false,
});
