"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { useSession } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";

import { FAVORITES_PAGE_SIZE } from "@/features/favorite/schemas";
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

export function useFavoritesFlow() {
  const { data: session, status: sessionStatus } = useSession();
  const userId = session?.user?.id ?? null;
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: [...favoritesListKey(userId), page, FAVORITES_PAGE_SIZE] as const,
    queryFn: ({ signal }) =>
      parseResponse(
        api.favorites.$get(
          { query: { page: String(page), perPage: String(FAVORITES_PAGE_SIZE) } },
          { init: { signal } },
        ),
      ),
    enabled: !!userId,
    placeholderData: keepPreviousData,
  });

  const totalPages = query.data?.pagination.pages ?? 1;

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return {
    userId,
    sessionStatus,
    page,
    setPage,
    data: query.data,
    isLoading: !!userId && query.isPending,
    isFetchingPage: query.isPlaceholderData,
    totalPages,
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
