"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { parseResponse } from "hono/client";
import { useMemo } from "react";
import { type DislikeKey, makeDislikeKey } from "../types";

import { fetchApi } from "@/lib/callApi";
import { api } from "@/lib/hono/client";

type DislikeRow = InferResponseType<typeof api.dislikes.$get, 200>[number];

const dislikesKey = (userId: string | null) => ["dislikes", userId] as const;

export function useDislikedKeys(userId: string | null): Set<DislikeKey> {
  const { data } = useQuery({
    queryKey: dislikesKey(userId),
    queryFn: () => parseResponse(api.dislikes.$get()),
    enabled: !!userId,
    staleTime: 60_000,
  });
  return useMemo(() => new Set((data ?? []).map((d) => makeDislikeKey(d.artistKey, d.titleKey))), [data]);
}

export function useDislikeTrack(userId: string | null) {
  const qc = useQueryClient();
  const key = dislikesKey(userId);
  return useMutation({
    mutationFn: ({
      artist,
      title,
      artistKey,
      titleKey,
    }: {
      artist: string;
      title: string;
      artistKey: string;
      titleKey: string;
    }) => fetchApi(api.dislikes.$post({ json: { artist, title, artistKey, titleKey } })),
    onMutate: async ({ artist, title, artistKey, titleKey }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<DislikeRow[]>(key) ?? [];
      if (!previous.some((d) => d.artistKey === artistKey && d.titleKey === titleKey)) {
        qc.setQueryData<DislikeRow[]>(key, [...previous, { artistKey, titleKey, artist, title }]);
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}
