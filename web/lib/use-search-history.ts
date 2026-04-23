"use client";

import { useState, useCallback, useEffect } from "react";

const MAX_HISTORY = 5;

export function useSearchHistory(storageKey: string) {
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setHistory(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, [storageKey]);

  const addToHistory = useCallback(
    (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) return;
      setHistory((prev) => {
        const deduped = [trimmed, ...prev.filter((h) => h !== trimmed)].slice(
          0,
          MAX_HISTORY
        );
        try {
          localStorage.setItem(storageKey, JSON.stringify(deduped));
        } catch {
          // ignore
        }
        return deduped;
      });
    },
    [storageKey]
  );

  return { history, addToHistory };
}
