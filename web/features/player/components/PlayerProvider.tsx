"use client";

import { BottomPlayer } from "@/features/player/components/BottomPlayer";

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <BottomPlayer />
    </>
  );
}
