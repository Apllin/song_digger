"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { useMemo } from "react";

import { fetchApi } from "@/lib/callApi";
import { api } from "@/lib/hono/client";

const favoriteIdsKey = (userId: string | null) => ["favorite-ids", userId] as const;
const favoritesListKey = (userId: string | null) => ["favorites", userId] as const;

export function useFavoriteIds(userId: string | null): Set<string> {
  const { data } = useQuery({
    queryKey: favoriteIdsKey(userId),
    queryFn: () => parseResponse(api.favorites.ids.$get()),
    enabled: !!userId,
    staleTime: 60_000,
  });
  return useMemo(() => new Set(data ?? []), [data]);
}

export function useFavorites(userId: string | null, page: number, perPage: number) {
  const query = useQuery({
    queryKey: [...favoritesListKey(userId), page, perPage] as const,
    queryFn: ({ signal }) =>
      parseResponse(
        api.favorites.$get({ query: { page: String(page), perPage: String(perPage) } }, { init: { signal } }),
      ),
    enabled: !!userId,
    // Keep the current page on screen while the next one loads so Prev/Next
    // doesn't blank the grid (and `totalPages` doesn't briefly read as the
    // `?? 1` fallback, which would trip the clamp-to-last-page effect).
    placeholderData: keepPreviousData,
  });

  return {
    tracks: query.data?.tracks ?? [],
    totalPages: query.data?.pagination.pages ?? 1,
    totalItems: query.data?.pagination.items ?? 0,
    loading: !!userId && query.isPending,
    isFetchingPage: query.isPlaceholderData,
  };
}

export function useToggleFavorite(userId: string | null) {
  const qc = useQueryClient();
  const idsKey = favoriteIdsKey(userId);
  return useMutation({
    mutationFn: ({ trackId, isFav }: { trackId: string; isFav: boolean }) =>
      isFav
        ? fetchApi(api.favorites.$delete({ query: { trackId } }))
        : fetchApi(api.favorites.$post({ json: { trackId } })),
    onMutate: async ({ trackId, isFav }) => {
      await qc.cancelQueries({ queryKey: idsKey });
      const previous = qc.getQueryData<string[]>(idsKey) ?? [];
      qc.setQueryData<string[]>(idsKey, isFav ? previous.filter((id) => id !== trackId) : [trackId, ...previous]);
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(idsKey, ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: idsKey });
      qc.invalidateQueries({ queryKey: favoritesListKey(userId) });
    },
  });
}
