"use client";

import { useCallback, useMemo } from "react";

import { PageLoader } from "@/components/PageLoader";
import { Pagination } from "@/components/Pagination";
import { TrackCard } from "@/components/TrackCard";
import { useUserId } from "@/features/auth/hooks/useUserId";
import { useDislikedKeys, useDislikeTrack } from "@/features/dislike/hooks/useDislikes";
import { makeDislikeKey } from "@/features/dislike/types";
import { useFavoriteIds, useToggleFavorite } from "@/features/favorite/hooks/useFavorites";
import { TrainerFeedbackButtons } from "@/features/feedback/components/TrainerFeedbackButtons";
import type { PlayerTrack } from "@/features/player/types";

export interface ResultsGridProps {
  tracks: PlayerTrack[];
  page: number;
  totalPages: number;
  totalItems: number;
  isLoading: boolean;
  searchQueryId?: string | null;
  summaryLabel?: (n: number) => string;
  onPrev: () => void;
  onNext: () => void;
}

const defaultSummaryLabel = (n: number) => `${n} result${n === 1 ? "" : "s"} · sorted by relevance`;

export function ResultsGrid({
  tracks,
  page,
  totalPages,
  totalItems,
  isLoading,
  searchQueryId,
  summaryLabel = defaultSummaryLabel,
  onPrev,
  onNext,
}: ResultsGridProps) {
  const userId = useUserId();
  const isAuthenticated = !!userId;

  const favoriteIds = useFavoriteIds(userId);
  const dislikedKeys = useDislikedKeys(userId);
  const { mutate: mutateFavorite } = useToggleFavorite(userId);
  const { mutate: mutateDislike } = useDislikeTrack(userId);

  const toggleFavorite = useCallback(
    (trackId: string) => mutateFavorite({ trackId, isFav: favoriteIds.has(trackId) }),
    [favoriteIds, mutateFavorite],
  );

  const handleDislike = useCallback(
    (track: PlayerTrack) => mutateDislike({ artist: track.artist, title: track.title }),
    [mutateDislike],
  );

  const visibleTracks = useMemo(
    () => tracks.filter((t) => !dislikedKeys.has(makeDislikeKey(t.artist, t.title))),
    [tracks, dislikedKeys],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between font-mono-td text-[11px] uppercase tracking-[0.14em] text-td-fg">
        <span style={{ textShadow: "0 1px 6px rgba(0,0,0,0.55)" }}>{summaryLabel(totalItems)}</span>
      </div>
      <div className="relative">
        <div
          className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-6 transition-opacity ${isLoading ? "opacity-40" : ""}`}
        >
          {visibleTracks.map((track, idx) => (
            <div key={track.id} className="flex flex-col">
              <TrackCard
                track={track}
                playlist={visibleTracks}
                trackIndex={idx}
                isFavorite={favoriteIds.has(track.id)}
                onFavoriteToggle={isAuthenticated ? toggleFavorite : undefined}
                onDislike={isAuthenticated ? () => handleDislike(track) : undefined}
              />
              {searchQueryId && <TrainerFeedbackButtons searchQueryId={searchQueryId} trackId={track.id} />}
            </div>
          ))}
        </div>
        {isLoading && <PageLoader />}
      </div>
      {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onPrev={onPrev} onNext={onNext} />}
    </div>
  );
}
