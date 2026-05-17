"use client";

import { atom } from "jotai";

import type { DiscogsLabel } from "@/lib/python-api/generated/types/DiscogsLabel";

interface LabelsState {
  page: number;
  query: string;
  selectedItem: DiscogsLabel | null;
}

export const labelsAtom = atom<LabelsState>({
  page: 1,
  query: "",
  selectedItem: null,
});
