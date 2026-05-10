"use client";

import { useEffect, useRef, useState } from "react";

const ENTRIES = [
  {
    label: "Album / EP / Single / Mix / Release",
    text: "The artist's own release. Tag is taken from the Discogs format string (EP, Album, Single, Compilation, Mix); falls back to Release when none of those keywords are present.",
  },
  {
    label: "Remix",
    text: "The artist remixed one of the tracks on this release.",
  },
  {
    label: "Producer",
    text: "The artist produced a track on someone else's release.",
  },
  {
    label: "Featured",
    text: "The artist's content sits on someone else's release — a compilation, DJ mix, or similar. Collapses the Discogs roles Appearance and TrackAppearance.",
  },
] as const;

export function ReleaseTagLegend() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="What do release tags mean?"
        aria-expanded={open}
        className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-mono-td transition-colors"
        style={{
          border: "1px solid var(--td-hair-2)",
          color: open ? "var(--td-accent)" : "var(--td-fg-m)",
          background: open ? "var(--td-accent-soft)" : "transparent",
        }}
      >
        ?
      </button>

      {open && (
        <div
          role="dialog"
          className="absolute z-50 top-full mt-2 right-0 w-[300px] rounded-xl border p-3 shadow-2xl backdrop-blur"
          style={{
            background: "rgba(20,18,26,0.95)",
            borderColor: "var(--td-hair-2)",
          }}
        >
          <p className="font-mono-td text-[10px] uppercase tracking-[0.14em] text-td-fg-m mb-2">Release tags</p>
          <ul className="flex flex-col gap-2">
            {ENTRIES.map((e) => (
              <li key={e.label} className="flex flex-col gap-0.5">
                <span className="text-[12px] font-medium text-td-fg">{e.label}</span>
                <span className="text-[11px] leading-snug text-td-fg-d">{e.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
