"use client";

import { useAtom } from "jotai";
import { showRegisterPromptAtom } from "@/lib/atoms/anon-limit";
import { RegisterPromptModal } from "./RegisterPromptModal";

// Layout-level mount point so search, discography, and labels pages
// can all flip a single atom to show the prompt without each
// embedding their own modal. ADR-0021.
export function AnonymousLimitModalHost() {
  const [open, setOpen] = useAtom(showRegisterPromptAtom);
  return <RegisterPromptModal open={open} onClose={() => setOpen(false)} />;
}
