"use client";

import { atom } from "jotai";

interface LabelsState {
  page: number;
  selectedName: string | null;
}

export const labelsAtom = atom<LabelsState>({
  page: 1,
  selectedName: null,
});
