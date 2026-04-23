"use client";

import { BottomPlayer } from "@/components/BottomPlayer";

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <BottomPlayer />
    </>
  );
}
