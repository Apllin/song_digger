"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useCallback } from "react";

import { SEARCH_PAGE_SIZE } from "@/features/search/schemas";
import { searchAtom } from "@/lib/atoms/search";
import { fetchApi } from "@/lib/callApi";
import { api } from "@/lib/hono/client";

const searchPageKey = (id: string | null, page: number) => ["search-page", id, page, SEARCH_PAGE_SIZE] as const;

export function useSearchFlow() {
  const [search, setSearch] = useAtom(searchAtom);
  const qc = useQueryClient();

  const {
    mutateAsync,
    isPending: isSearching,
    isSuccess,
    isError,
  } = useMutation({
    mutationFn: (input: string) => fetchApi(api.search.$post({ json: { input } })),
    onSuccess: (result) => {
      qc.setQueryData(searchPageKey(result.id, 1), result);
      setSearch((prev) => ({ ...prev, id: result.id, page: 1 }));
    },
  });

  const startSearch = useCallback(
    async (rawQuery: string) => {
      const trimmed = rawQuery.trim();
      if (!trimmed || isSearching) return;
      setSearch((prev) => ({ ...prev, id: null, page: 1 }));
      await mutateAsync(trimmed).catch(() => {});
    },
    [isSearching, mutateAsync, setSearch],
  );

  const pageQuery = useQuery({
    queryKey: searchPageKey(search.id, search.page),
    queryFn: ({ signal }) =>
      fetchApi(
        api.search[":id"].$get(
          {
            param: { id: search.id! },
            query: { page: String(search.page), perPage: String(SEARCH_PAGE_SIZE) },
          },
          { init: { signal } },
        ),
      ),
    enabled: search.id != null,
    // A completed search's pages are immutable, so the cache primed by the
    // POST never needs an immediate background refetch.
    staleTime: 60_000,
    // Keep the previous page on screen while the next one loads — Prev/Next
    // shows a small overlay loader instead of unmounting the whole grid.
    placeholderData: keepPreviousData,
  });

  return {
    search,
    setSearch,
    startSearch,
    isSearching,
    // True only while a new search is running; page navigation is `isFetchingPage`.
    isFetchingPage: search.id != null && pageQuery.isFetching,
    isSuccess,
    isError,
    tracks: pageQuery.data?.tracks ?? [],
    pagination: pageQuery.data?.pagination ?? null,
  };
}
