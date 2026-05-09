"use client";

import type { PointerEvent } from "react";

import { formatTime } from "@/features/player/utils";

interface ProgressBarProps {
  currentTime: number;
  duration: number;
  onSeek: (pct: number) => void;
}

export function PlayerProgressBar({ currentTime, duration, onSeek }: ProgressBarProps) {
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const seekFromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(pct);
  };

  return (
    <div className="flex items-center gap-2 font-mono-td">
      <span className="text-[10px] text-td-fg-m tabular-nums w-8 text-right shrink-0">{formatTime(currentTime)}</span>
      <div
        role="slider"
        aria-label="Seek"
        aria-valuenow={Math.round(currentTime)}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        className="flex-1 h-1.25 rounded-full cursor-pointer group/bar touch-none"
        style={{ background: "rgba(255, 255, 255, 0.18)" }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromPointer(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            seekFromPointer(e);
          }
        }}
      >
        <div
          className="h-full rounded-full relative"
          style={{
            width: `${progressPct}%`,
            background: "var(--td-accent)",
            boxShadow: "0 0 12px var(--td-accent)",
          }}
        >
          <div
            className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 w-3.25 h-3.25 rounded-full transition-transform group-hover/bar:scale-110"
            style={{
              background: "#ffffff",
              border: "2px solid var(--td-accent)",
              boxShadow: "0 0 0 1px rgba(0,0,0,0.3), 0 0 12px var(--td-accent-soft)",
            }}
          />
        </div>
      </div>
      <span className="text-[10px] text-td-fg-m tabular-nums w-8 shrink-0">{formatTime(duration)}</span>
    </div>
  );
}
