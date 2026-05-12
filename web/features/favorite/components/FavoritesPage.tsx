"use client";

import Link from "next/link";
import { getSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { useFavoriteIds, useFavorites, useToggleFavorite } from "../hooks/useFavorites";
import { FAVORITES_PAGE_SIZE } from "../schemas";

import { PageLoader } from "@/components/PageLoader";
import { Pagination } from "@/components/Pagination";
import { TrackCard } from "@/components/TrackCard";
import type { PlayerTrack } from "@/features/player/types";

export function FavoritesPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [resolvedSession, setResolvedSession] = useState(false);
  const [page, setPage] = useState(1);

  // SessionProvider isn't wired site-wide; getSession does its own /api
  // call which is fine for a single read.
  useEffect(() => {
    let cancelled = false;
    getSession()
      .then((s) => {
        if (!cancelled) setUserId(s?.user?.id ?? null);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setResolvedSession(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { tracks, totalPages, totalItems, loading, isFetchingPage } = useFavorites(userId, page, FAVORITES_PAGE_SIZE);
  const favoriteIds = useFavoriteIds(userId);
  const { mutate: mutateFavorite } = useToggleFavorite(userId);

  // Removing the last item on the final page can shrink the page count below
  // the current page — snap back so we never sit on an empty page.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const removeFavorite = useCallback((trackId: string) => mutateFavorite({ trackId, isFav: true }), [mutateFavorite]);

  return (
    <div className="min-h-screen text-td-fg">
      <div className="max-w-7xl mx-auto px-4 sm:px-7 pt-8 sm:pt-16 pb-28 flex flex-col gap-5 sm:gap-7">
        <div className="pt-2 sm:pt-4">
          <h1
            className="font-display text-td-fg m-0"
            style={{
              fontSize: "clamp(34px, 6.5vw, 84px)",
              lineHeight: 0.9,
              letterSpacing: "-0.02em",
              fontWeight: 600,
            }}
          >
            Favorites
          </h1>
          <p className="mt-4 text-[18px] sm:text-[20px] font-semibold text-td-fg">The tracks you saved</p>
        </div>

        {resolvedSession && !userId && (
          <div className="flex flex-col items-center gap-3 py-20 text-td-fg-m">
            <p className="text-sm">
              <Link href="/login" className="text-td-accent underline underline-offset-4">
                Sign in
              </Link>{" "}
              to see your favorites.
            </p>
          </div>
        )}

        {userId && loading && totalItems === 0 && (
          <div className="flex justify-center py-20">
            <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24" style={{ color: "var(--td-accent)" }}>
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          </div>
        )}

        {userId && !loading && totalItems === 0 && (
          <div className="flex flex-col items-center gap-2 py-20 text-td-fg-m">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
              />
            </svg>
            <p className="text-sm">No favorites yet. Tap the heart on a track to save it here.</p>
          </div>
        )}

        {userId && totalItems > 0 && (
          <FavoritesGrid
            tracks={tracks}
            favoriteIds={favoriteIds}
            onRemove={removeFavorite}
            page={page}
            totalPages={totalPages}
            totalItems={totalItems}
            isLoading={isFetchingPage}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
          />
        )}
      </div>
    </div>
  );
}

interface FavoritesGridProps {
  tracks: PlayerTrack[];
  favoriteIds: Set<string>;
  onRemove: (trackId: string) => void;
  page: number;
  totalPages: number;
  totalItems: number;
  isLoading: boolean;
  onPrev: () => void;
  onNext: () => void;
}

function FavoritesGrid({
  tracks,
  favoriteIds,
  onRemove,
  page,
  totalPages,
  totalItems,
  isLoading,
  onPrev,
  onNext,
}: FavoritesGridProps) {
  const playlist: PlayerTrack[] = tracks.map((t) => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    source: t.source,
    sourceUrl: t.sourceUrl,
    coverUrl: t.coverUrl,
    embedUrl: t.embedUrl,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between font-mono-td text-[11px] uppercase tracking-[0.14em] text-td-fg">
        <span style={{ textShadow: "0 1px 6px rgba(0,0,0,0.55)" }}>
          {totalItems} saved track{totalItems === 1 ? "" : "s"}
        </span>
      </div>
      <div className="relative">
        <div
          className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-6 transition-opacity ${isLoading ? "opacity-40" : ""}`}
        >
          {tracks.map((track, idx) => (
            <TrackCard
              key={track.id}
              track={track}
              playlist={playlist}
              trackIndex={idx}
              isFavorite={favoriteIds.has(track.id)}
              onFavoriteToggle={onRemove}
            />
          ))}
        </div>
        {isLoading && <PageLoader />}
      </div>
      {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onPrev={onPrev} onNext={onNext} />}
    </div>
  );
}
