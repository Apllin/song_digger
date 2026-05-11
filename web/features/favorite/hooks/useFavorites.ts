"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { parseResponse } from "hono/client";
import { useMemo } from "react";

import { fetchApi } from "@/lib/callApi";
import { api } from "@/lib/hono/client";

type FavoriteRow = InferResponseType<typeof api.favorites.$get, 200>[number];

const favoritesKey = (userId: string | null) => ["favorites", userId] as const;

export function useFavoriteIds(userId: string | null): Set<string> {
  const { data } = useQuery({
    queryKey: favoritesKey(userId),
    queryFn: () => parseResponse(api.favorites.$get()),
    enabled: !!userId,
    staleTime: 60_000,
  });
  return useMemo(() => new Set((data ?? []).map((t) => t.id)), [data]);
}

export function useToggleFavorite(userId: string | null) {
  const qc = useQueryClient();
  const key = favoritesKey(userId);
  return useMutation({
    mutationFn: ({ trackId, isFav }: { trackId: string; isFav: boolean }) =>
      isFav
        ? fetchApi(api.favorites.$delete({ query: { trackId } }))
        : fetchApi(api.favorites.$post({ json: { trackId } })),
    onMutate: async ({ trackId, isFav }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<FavoriteRow[]>(key) ?? [];
      qc.setQueryData<FavoriteRow[]>(
        key,
        isFav ? previous.filter((t) => t.id !== trackId) : [...previous, { id: trackId } as FavoriteRow],
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}
