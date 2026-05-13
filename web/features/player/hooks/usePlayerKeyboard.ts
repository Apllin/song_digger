import { useEffect } from "react";

interface UsePlayerKeyboardOptions {
  trackId: string;
  toggle: () => void;
  playNext: () => void;
  playPrev: () => void;
}

export function usePlayerKeyboard({ trackId, toggle, playNext, playPrev }: UsePlayerKeyboardOptions) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.isContentEditable) return;
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        playNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        playPrev();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [playNext, playPrev, toggle, trackId]);
}
