"use client";

import { useSearchParams } from "next/navigation";
import { getSession } from "next-auth/react";
import { Suspense, useCallback, useEffect, useState } from "react";

import { PageLoader } from "@/components/PageLoader";
import { Pagination } from "@/components/Pagination";
import { SearchBar } from "@/components/SearchBar";
import { TrackCard } from "@/components/TrackCard";
import { useDislikedKeys, useDislikeTrack } from "@/features/dislike/hooks/useDislikes";
import { makeDislikeKey } from "@/features/dislike/types";
import { useFavoriteIds, useToggleFavorite } from "@/features/favorite/hooks/useFavorites";
import { usePlayer } from "@/features/player/hooks/usePlayer";
import type { PlayerTrack } from "@/features/player/types";
import { useSearchFlow } from "@/features/search/hooks/useSearchFlow";

export default function Home() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const player = usePlayer();
  const [userId, setUserId] = useState<string | null>(null);
  const isAuthenticated = !!userId;

  // SessionProvider isn't wired site-wide; getSession does its own /api
  // call which is fine for a single read.
  useEffect(() => {
    let cancelled = false;
    getSession()
      .then((s) => {
        if (!cancelled) setUserId(s?.user?.id ?? null);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, []);

  const favoriteIds = useFavoriteIds(userId);
  const dislikedKeys = useDislikedKeys(userId);
  const { mutate: mutateFavorite } = useToggleFavorite(userId);
  const { mutate: mutateDislike } = useDislikeTrack(userId);

  const { search, setSearch, startSearch, isSearching, isFetchingPage, isError, tracks, pagination } = useSearchFlow();
  const { query, page } = search;

  const handleSearch = useCallback(() => startSearch(query), [query, startSearch]);

  // Auto-search when opened via "Find similar" link (?q=...)
  useEffect(() => {
    const q = searchParams.get("q");
    if (q) {
      setSearch((prev) => ({ ...prev, query: q }));
      startSearch(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleFavorite = useCallback(
    (trackId: string) => {
      const isFav = favoriteIds.has(trackId);
      mutateFavorite({ trackId, isFav });
    },
    [favoriteIds, mutateFavorite],
  );

  const handleDislike = useCallback(
    (track: { id: string; sourceUrl: string; title: string; artist: string }) => {
      // Compare by id — sourceUrl may have been swapped to a resolved
      // YTM/Bandcamp URL by BottomPlayer for non-YTM/non-bandcamp originals.
      if (player.track?.id === track.id) {
        player.close();
      }
      mutateDislike({ artist: track.artist, title: track.title });
    },
    [player, mutateDislike],
  );

  // Only disliked tracks drop out of the results. Favorited tracks stay put —
  // the heart on their card just lights up (see `isFavorite` below).
  const visibleTracks = tracks.filter((t) => !dislikedKeys.has(makeDislikeKey(t.artist, t.title)));

  return (
    <div className="min-h-screen text-td-fg">
      <div className="max-w-7xl mx-auto px-4 sm:px-7 pt-8 sm:pt-16 pb-28 flex flex-col gap-5 sm:gap-7">
        {/* Hero: display headline — two-line, Handshake-style impact.
            Tight leading + negative tracking give the SansPlomb-feel
            while we render in the project's display family. */}
        <div className="pt-2 sm:pt-4">
          <h1
            className="font-display text-td-fg m-0"
            style={{
              fontSize: "clamp(40px, 8.5vw, 108px)",
              lineHeight: 0.85,
              letterSpacing: "-0.02em",
              fontWeight: 600,
            }}
          >
            <span className="block">Find your next</span>
            <span className="block">favourite track</span>
          </h1>
        </div>

        {/* Search */}
        <SearchBar
          value={query}
          onChange={(v) => setSearch((prev) => ({ ...prev, query: v }))}
          onSubmit={handleSearch}
          loading={isSearching}
        />

        {/* States */}
        {isSearching && (
          <div className="flex flex-col items-center gap-3 py-20 text-td-fg-d">
            <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24" style={{ color: "var(--td-accent)" }}>
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <p className="text-sm">Searching across sources…</p>
          </div>
        )}

        {isError && (
          <div
            className="rounded-xl border px-4 py-3 text-sm"
            style={{
              borderColor: "rgba(220,90,90,0.45)",
              background: "rgba(120,30,30,0.18)",
              color: "#f3b8b8",
            }}
          >
            Search failed. Please try again.
          </div>
        )}

        {!isSearching && pagination != null && pagination.items === 0 && (
          <div className="flex flex-col items-center gap-2 py-20 text-td-fg-m">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z"
              />
            </svg>
            <p className="text-sm">No tracks found. Try a different query or adjust filters.</p>
          </div>
        )}

        {/* Results */}
        {!isSearching && pagination != null && pagination.items > 0 && (
          <ResultsGrid
            tracks={visibleTracks}
            page={page}
            totalPages={pagination.pages}
            totalItems={pagination.items}
            isLoading={isFetchingPage}
            isAuthenticated={isAuthenticated}
            favoriteIds={favoriteIds}
            onFavoriteToggle={toggleFavorite}
            onDislike={handleDislike}
            onPrev={() => setSearch((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
            onNext={() => setSearch((prev) => ({ ...prev, page: Math.min(pagination.pages, prev.page + 1) }))}
          />
        )}
      </div>
    </div>
  );
}

interface ResultsGridProps {
  tracks: PlayerTrack[];
  page: number;
  totalPages: number;
  totalItems: number;
  isLoading: boolean;
  isAuthenticated: boolean;
  favoriteIds: Set<string>;
  onFavoriteToggle: (trackId: string) => void;
  onDislike: (track: { id: string; sourceUrl: string; title: string; artist: string }) => void;
  onPrev: () => void;
  onNext: () => void;
}

function ResultsGrid({
  tracks,
  page,
  totalPages,
  totalItems,
  isLoading,
  isAuthenticated,
  favoriteIds,
  onFavoriteToggle,
  onDislike,
  onPrev,
  onNext,
}: ResultsGridProps) {
  // Every visible track goes into the playlist — non-YTM/non-bandcamp
  // entries are resolved on demand by BottomPlayer via /api/embed.
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
          {totalItems} result{totalItems === 1 ? "" : "s"} · sorted by relevance
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
              onFavoriteToggle={isAuthenticated ? onFavoriteToggle : undefined}
              onDislike={isAuthenticated ? () => onDislike(track) : undefined}
            />
          ))}
        </div>
        {isLoading && <PageLoader />}
      </div>
      {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onPrev={onPrev} onNext={onNext} />}
    </div>
  );
}
