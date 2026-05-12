"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useHydrateAtoms } from "jotai/utils";
import { useCallback, useEffect } from "react";

import type { SearchQueryId } from "@/features/search/schemas";
import { SEARCH_PAGE_SIZE } from "@/features/search/schemas";
import { searchAtom } from "@/lib/atoms/search";
import { fetchApi } from "@/lib/callApi";
import { api } from "@/lib/hono/client";

export function useSearchFlow(initialQuery = "") {
  useHydrateAtoms([[searchAtom, { query: initialQuery, id: null, page: 1 }]]);

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
      qc.setQueryData(searchPageKey(id, 1), result.id);
      setSearch((prev) => ({ ...prev, id, page: 1 }));
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

  useEffect(() => {
    if (initialQuery) {
      startSearch(initialQuery);
    }
  }, [initialQuery, startSearch]);

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
    staleTime: 60_000,
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
    data: pageQuery.data,
  };
}

function searchPageKey(id: SearchQueryId | null, page: number) {
  return ["search-page", id, page, SEARCH_PAGE_SIZE] as const;
}
