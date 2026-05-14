"use client";

import { useQueries } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { useAtom } from "jotai";
import { useEffect, useMemo } from "react";

import { unplayableTrackIdsAtom } from "@/features/player/atoms";
import { PLAYABLE_SOURCES } from "@/features/player/constants";
import type { PlayerTrack, TrackSource } from "@/features/player/types";
import { api } from "@/lib/hono/client";

const LOOKAHEAD = 3;

interface Props {
  playlist: PlayerTrack[];
  playingIndex: number | null;
}

interface EmbedData {
  embedUrl: string | null;
  source: TrackSource | null;
  sourceUrl: string | null;
  coverUrl: string | null;
}

// Warms the React Query cache for upcoming tracks so the next-click handoff
// is instant. The embed query key matches useAudioPlayer's, so resolutions
// fetched here are reused at play time. Returns nothing — pure side effect.
export function useNextTrackPreload({ playlist, playingIndex }: Props) {
  const [unplayableIds, setUnplayableIds] = useAtom(unplayableTrackIdsAtom);

  const upcoming = useMemo(() => {
    if (playingIndex === null) return [];
    const result: PlayerTrack[] = [];
    for (let i = playingIndex + 1; i < playlist.length && result.length < LOOKAHEAD; i++) {
      const t = playlist[i];
      if (!t || unplayableIds.has(t.id)) continue;
      result.push(t);
    }
    return result;
  }, [playlist, playingIndex, unplayableIds]);

  const queries = useQueries({
    queries: upcoming.map((t) => {
      const needsResolution = !!t.source && !PLAYABLE_SOURCES.has(t.source);
      return {
        queryKey: ["embed", t.title, t.artist],
        queryFn: async ({ signal }: { signal: AbortSignal }): Promise<EmbedData | null> => {
          const raw = await parseResponse(
            api.embed.$get({ query: { title: t.title, artist: t.artist } }, { init: { signal } }),
          );
          if (!raw) return null;
          return { ...raw, source: raw.source as TrackSource | null };
        },
        enabled: needsResolution,
        staleTime: Infinity,
        retry: 1,
      };
    }),
  });

  useEffect(() => {
    const newlyUnplayable: string[] = [];
    queries.forEach((q, idx) => {
      const t = upcoming[idx];
      if (!t || q.status !== "success") return;
      const data = q.data;
      if (!data || !data.embedUrl || !data.source) {
        if (!unplayableIds.has(t.id)) newlyUnplayable.push(t.id);
      }
    });
    if (newlyUnplayable.length === 0) return;
    setUnplayableIds((prev) => {
      const next = new Set(prev);
      for (const id of newlyUnplayable) next.add(id);
      return next;
    });
  }, [queries, upcoming, unplayableIds, setUnplayableIds]);
}
