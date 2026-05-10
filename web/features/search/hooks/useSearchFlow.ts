"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { useAtom } from "jotai";
import { useCallback, useEffect, useState } from "react";

import { searchAtom } from "@/lib/atoms/search";
import { fetchApi } from "@/lib/callApi";
import { api } from "@/lib/hono/client";

const POLL_INTERVAL_MS = 600;
const POLL_TIMEOUT_MS = 90_000;

interface StartOptions {
  append?: boolean;
}

export function useSearchFlow() {
  const [search, setSearch] = useAtom(searchAtom);
  const [searchId, setSearchId] = useState<string | null>(null);
  const [appendMode, setAppendMode] = useState(false);
  const [pollStartedAt, setPollStartedAt] = useState<number | null>(null);

  const pollQuery = useQuery({
    queryKey: ["search-poll", searchId] as const,
    queryFn: ({ signal }) => parseResponse(api.search[":id"].$get({ param: { id: searchId! } }, { init: { signal } })),
    enabled: !!searchId,
    refetchInterval: ({ state }) => {
      if (!state.data) return POLL_INTERVAL_MS;
      return state.data.status === "running" ? POLL_INTERVAL_MS : false;
    },
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    const data = pollQuery.data;
    if (!data) return;
    setSearch((prev) => {
      let nextTracks = prev.tracks;
      if (data.tracks?.length) {
        if (appendMode) {
          const seen = new Set(prev.tracks.map((t) => t.sourceUrl));
          const fresh = data.tracks.filter((t) => !seen.has(t.sourceUrl));
          nextTracks = [...prev.tracks, ...fresh];
        } else {
          nextTracks = data.tracks;
        }
      }
      const terminal = data.status === "done" || data.status === "error";
      return {
        ...prev,
        tracks: nextTracks,
        ...(terminal
          ? {
              status: data.status === "done" ? ("done" as const) : ("error" as const),
              errorMsg: data.status === "error" ? "Search failed. Please try again." : prev.errorMsg,
            }
          : {}),
      };
    });
    if (data.status === "done" || data.status === "error") {
      setSearchId(null);
      setPollStartedAt(null);
    }
  }, [pollQuery.data, appendMode, setSearch]);

  useEffect(() => {
    if (!pollStartedAt || !searchId) return;
    const elapsed = Date.now() - pollStartedAt;
    const remaining = POLL_TIMEOUT_MS - elapsed;
    const fail = () => {
      setSearchId(null);
      setPollStartedAt(null);
      setSearch((prev) =>
        prev.status === "running"
          ? { ...prev, status: "error", errorMsg: "Search timed out. Please try again." }
          : prev,
      );
    };
    if (remaining <= 0) {
      fail();
      return;
    }
    const timer = setTimeout(fail, remaining);
    return () => clearTimeout(timer);
  }, [pollStartedAt, searchId, setSearch]);

  const startMutation = useMutation({
    mutationFn: (input: string) => fetchApi(api.search.$post({ json: { input } })),
  });

  const startSearch = useCallback(
    async (rawQuery: string, { append = false }: StartOptions = {}) => {
      const trimmed = rawQuery.trim();
      if (!trimmed || search.status === "running") return;

      setSearchId(null);
      setPollStartedAt(null);
      setAppendMode(append);
      setSearch((prev) =>
        append
          ? { ...prev, status: "running", errorMsg: "" }
          : { ...prev, tracks: [], errorMsg: "", status: "running", displayCount: 18 },
      );

      try {
        const data = await startMutation.mutateAsync(trimmed);
        if (!data) {
          setSearch((prev) => ({ ...prev, status: "idle", errorMsg: "" }));
          return;
        }
        setSearchId(data.id);
        setPollStartedAt(Date.now());
      } catch (err) {
        console.error("[search] error:", err);
        setSearch((prev) => ({
          ...prev,
          status: "error",
          errorMsg: append ? "Failed to load more tracks." : "Failed to start search. Is the server running?",
        }));
      }
    },
    [search.status, setSearch, startMutation],
  );

  return {
    search,
    setSearch,
    startSearch,
    isLoading: search.status === "running",
  };
}
