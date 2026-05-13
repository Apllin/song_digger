import { atom } from "jotai";

// Persists which accordions are open across navigation.
// Fetched tracklists are cached by React Query — no need to store them here.
export const discographyOpenAtom = atom<Record<string, boolean>>({});
