"use client";

import { useMutation } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useCallback } from "react";

import { searchAtom } from "@/lib/atoms/search";
import { fetchApi } from "@/lib/callApi";
import { api } from "@/lib/hono/client";

export function useSearchFlow() {
  const [search, setSearch] = useAtom(searchAtom);

  const { mutateAsync, isPending, isSuccess, isError } = useMutation({
    mutationFn: (input: string) => fetchApi(api.search.$post({ json: { input } })),
    onSuccess: (result) => {
      setSearch((prev) => ({ ...prev, tracks: result.tracks, displayCount: 18 }));
    },
  });

  const startSearch = useCallback(
    async (rawQuery: string) => {
      const trimmed = rawQuery.trim();
      if (!trimmed || isPending) return;
      setSearch((prev) => ({ ...prev, tracks: [], displayCount: 18 }));
      await mutateAsync(trimmed).catch(() => {});
    },
    [isPending, mutateAsync, setSearch],
  );

  return {
    search,
    setSearch,
    startSearch,
    isLoading: isPending,
    isSuccess,
    isError,
  };
}
