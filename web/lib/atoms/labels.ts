"use client";

import { atom } from "jotai";

interface LabelsState {
  page: number;
}

export const labelsAtom = atom<LabelsState>({
  page: 1,
});
