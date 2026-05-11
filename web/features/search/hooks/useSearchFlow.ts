"use client";

import { useMutation } from "@tanstack/react-query";
import { DetailedError, parseResponse } from "hono/client";
import { useAtom } from "jotai";
import { useCallback } from "react";

import { apiEvents } from "@/lib/apiEvents";
import { searchAtom } from "@/lib/atoms/search";
import { api } from "@/lib/hono/client";

interface StartOptions {
  append?: boolean;
}

function isAnonLimitError(err: unknown): boolean {
  return (
    err instanceof DetailedError &&
    (err.detail?.data as { error?: unknown } | undefined)?.error === "ANONYMOUS_LIMIT_REACHED"
  );
}

export function useSearchFlow() {
  const [search, setSearch] = useAtom(searchAtom);

  const { mutateAsync } = useMutation({
    mutationFn: (input: string) => parseResponse(api.search.$post({ json: { input } })),
  });

  const startSearch = useCallback(
    async (rawQuery: string, { append = false }: StartOptions = {}) => {
      const trimmed = rawQuery.trim();
      if (!trimmed || search.status === "running") return;

      setSearch((prev) =>
        append
          ? { ...prev, status: "running", errorMsg: "" }
          : { ...prev, tracks: [], errorMsg: "", status: "running", displayCount: 18 },
      );

      try {
        const data = await mutateAsync(trimmed);

        setSearch((prev) => {
          if (append) {
            const seen = new Set(prev.tracks.map((t) => t.sourceUrl));
            return {
              ...prev,
              status: "done",
              tracks: [...prev.tracks, ...data.tracks.filter((t) => !seen.has(t.sourceUrl))],
            };
          }
          return { ...prev, status: "done", tracks: data.tracks };
        });
      } catch (err) {
        if (isAnonLimitError(err)) {
          apiEvents.emit("error:anon-limit");
          setSearch((prev) => ({ ...prev, status: "idle", errorMsg: "" }));
          return;
        }
        console.error("[search] error:", err);
        setSearch((prev) => ({
          ...prev,
          status: "error",
          errorMsg: append ? "Failed to load more tracks." : "Search failed. Please try again.",
        }));
      }
    },
    [search.status, setSearch, mutateAsync],
  );

  return {
    search,
    setSearch,
    startSearch,
    isLoading: search.status === "running",
  };
}
