"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useHydrateAtoms } from "jotai/utils";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { onPlaylistEndAtom, playerAtom } from "@/features/player/atoms";
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

  const setEndHandler = useSetAtom(onPlaylistEndAtom);
  const player = useAtomValue(playerAtom);
  const totalPages = pageQuery.data?.pagination.pages ?? 1;
  const currentPage = search.page;
  const searchId = search.id;

  // Highest search page already represented in the player's playlist. Used to
  // detect when the player is active in this search session and to seed the
  // cursor ref. The cursor ref itself is then incremented imperatively in the
  // handler so re-registration after each page load does not reset it.
  const playerLastPage = useMemo(() => {
    if (searchId == null || player.playlist.length === 0) return 0;
    const playerIds = new Set(player.playlist.map((t) => t.id));
    for (let p = totalPages; p >= 1; p--) {
      const cached = qc.getQueryData<{ tracks: PlayerTrack[] }>(searchPageKey(searchId, p));
      if (!cached) continue;
      if (cached.tracks.some((t) => playerIds.has(t.id))) return p;
    }
    return 0;
  }, [searchId, player.playlist, totalPages, qc]);

  // Tracks which page the player last consumed. Incremented by the handler
  // so that effect re-runs (e.g. when UI currentPage changes) do not reset it.
  const playerPageCursorRef = useRef(0);
  useEffect(() => {
    playerPageCursorRef.current = 0;
  }, [searchId]);

  useEffect(() => {
    if (searchId == null || playerLastPage === 0 || playerLastPage >= totalPages) {
      setEndHandler(null);
      return;
    }

    playerPageCursorRef.current = Math.max(playerPageCursorRef.current, playerLastPage);

    setEndHandler({
      onEnd: (appendAndAdvance) => {
        const nextPage = playerPageCursorRef.current + 1;
        if (nextPage > totalPages) {
          setEndHandler(null);
          return;
        }
        playerPageCursorRef.current = nextPage;
        void qc
          .fetchQuery({
            queryKey: searchPageKey(searchId, nextPage),
            queryFn: ({ signal }) =>
              fetchApi(
                api.search[":id"].$get(
                  { param: { id: searchId }, query: { page: String(nextPage), perPage: String(SEARCH_PAGE_SIZE) } },
                  { init: { signal } },
                ),
              ),
            staleTime: 60_000,
          })
          .then((data) => {
            appendAndAdvance(data.tracks);
            // Advance the UI only when the player is catching up to or past
            // the user's current view.
            if (nextPage > currentPage) {
              setSearch((prev) => ({ ...prev, page: nextPage }));
            }
            if (nextPage >= totalPages) setEndHandler(null);
          });
      },
    });
    return () => setEndHandler(null);
  }, [searchId, playerLastPage, currentPage, totalPages, qc, setEndHandler, setSearch]);

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
