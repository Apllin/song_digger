"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useHydrateAtoms } from "jotai/utils";
import { useCallback, useEffect, useMemo } from "react";

import { playerAtom, playlistExtenderAtom } from "@/features/player/atoms";
import type { PlayerTrack } from "@/features/player/types";
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

  const setExtender = useSetAtom(playlistExtenderAtom);
  const playerPlaylist = useAtomValue(playerAtom).playlist;
  const totalPages = pageQuery.data?.pagination.pages ?? 1;
  const currentPage = search.page;
  const searchId = search.id;

  // Highest search page already represented in the player's playlist. The
  // extender's cursor tracks this, not the UI's `currentPage` — otherwise
  // the player skips pages when the user paginates the UI ahead of playback
  // (e.g. user on page 1 last track, clicks UI next → currentPage=2, then
  // clicks player next → old code would fetch page 3 because it derived the
  // cursor from currentPage).
  const playerLastPage = useMemo(() => {
    if (searchId == null || playerPlaylist.length === 0) return 0;
    const playerIds = new Set(playerPlaylist.map((t) => t.id));
    for (let p = totalPages; p >= 1; p--) {
      const cached = qc.getQueryData<{ tracks: PlayerTrack[] }>(searchPageKey(searchId, p));
      if (!cached) continue;
      if (cached.tracks.some((t) => playerIds.has(t.id))) return p;
    }
    return 0;
  }, [searchId, playerPlaylist, totalPages, qc]);

  useEffect(() => {
    if (searchId == null || playerLastPage === 0) {
      setExtender(null);
      return;
    }
    const hasMore = playerLastPage < totalPages;
    if (!hasMore) {
      setExtender(null);
      return;
    }
    setExtender({
      hasMore: true,
      loadMore: async () => {
        const nextPage = playerLastPage + 1;
        const data = await qc.fetchQuery({
          queryKey: searchPageKey(searchId, nextPage),
          queryFn: ({ signal }) =>
            fetchApi(
              api.search[":id"].$get(
                {
                  param: { id: searchId },
                  query: { page: String(nextPage), perPage: String(SEARCH_PAGE_SIZE) },
                },
                { init: { signal } },
              ),
            ),
          staleTime: 60_000,
        });
        // Advance the UI only when the player is catching up to or past the
        // user's current view. Yanking the UI back to an earlier page after
        // the user explicitly navigated ahead is more disorienting than
        // useful.
        if (nextPage > currentPage) {
          setSearch((prev) => ({ ...prev, page: nextPage }));
        }
        return data.tracks as PlayerTrack[];
      },
    });
    return () => setExtender(null);
  }, [searchId, playerLastPage, currentPage, totalPages, qc, setExtender, setSearch]);

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
