"use client";

import { useAtom } from "jotai";
import { useEffect } from "react";
import { RegisterPromptModal } from "./RegisterPromptModal";

import { apiEvents } from "@/lib/apiEvents";
import { showRegisterPromptAtom } from "@/lib/atoms/anon-limit";

export function AnonymousLimitModalHost() {
  const [open, setOpen] = useAtom(showRegisterPromptAtom);

  useEffect(() => apiEvents.on("error:anon-limit", () => setOpen(true)), [setOpen]);

  return <RegisterPromptModal open={open} onClose={() => setOpen(false)} />;
}
