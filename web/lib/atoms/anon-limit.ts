import { atom } from "jotai";

// Cross-page flag: set true when any fetch returns
// 429 ANONYMOUS_LIMIT_REACHED. The shared modal in
// components/auth/AnonymousLimitModalHost reads this. ADR-0021.
export const showRegisterPromptAtom = atom<boolean>(false);
